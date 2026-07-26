import * as dgram from "dgram";
import * as os from "os";
import {
  NodeType,
  TCNetDataPacketType,
  TCNetManagementHeader,
  TCNetMessageType,
  TCNetOptInPacket,
  TCNetStatusPacket,
  TCNetTimePacket,
} from "@s0/node-tcnet";
import type { TrackInfo } from "./rekordbox-reader";
import {
  ShowKontrolPlaybackState,
  type ConfirmedShowKontrolTrack,
  type ShowKontrolLayerSnapshot,
  type ShowKontrolMetadata,
} from "./showkontrol-state";

const TCNET_CONTROL_PORT = 60_000;
const TCNET_TIME_PORT = 60_001;
const TCNET_UNICAST_MIN = 65_023;
const TCNET_UNICAST_MAX = 65_535;
const MASTER_STALE_MS = 5_000;
const METADATA_RETRY_MS = 2_000;
const STATUS_EMIT_MIN_MS = 500;

export interface ShowKontrolNetworkInterface {
  name: string;
  address: string;
  netmask: string;
  broadcast: string;
}

export interface ShowKontrolReaderOptions {
  networkInterface?: string;
  confirmationSeconds?: number;
  fallbackConfirmationSeconds?: number;
  onTrack?: (track: ConfirmedShowKontrolTrack) => void;
  onStatus?: (status: ShowKontrolReaderStatus) => void;
}

export interface ShowKontrolReaderStatus {
  state: "stopped" | "searching" | "connected" | "error";
  connected: boolean;
  masterName: string | null;
  masterAddress: string | null;
  networkInterfaces: ShowKontrolNetworkInterface[];
  discoveredLayers: number;
  playingLayers: number;
  onAirAvailable: boolean;
  currentLayer: number | null;
  currentDeck: string | null;
  lastPacketAt: string | null;
  lastError: string | null;
  layers: ShowKontrolLayerSnapshot[];
}

export interface ShowKontrolLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}

interface TCNetMaster {
  address: string;
  port: number;
  nodeId: number;
  name: string;
  lastSeenAt: number;
}

interface SenderSocket {
  socket: dgram.Socket;
  network: ShowKontrolNetworkInterface;
}

function ipv4ToInt(address: string): number {
  return address
    .split(".")
    .reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function broadcastAddress(address: string, netmask: string): string {
  const addressInt = ipv4ToInt(address);
  const maskInt = ipv4ToInt(netmask);
  return intToIpv4((addressInt | (~maskInt >>> 0)) >>> 0);
}

export function listShowKontrolNetworkInterfaces(): ShowKontrolNetworkInterface[] {
  const results: ShowKontrolNetworkInterface[] = [];
  const interfaces = os.networkInterfaces();

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses || /^(lo|utun|awdl|llw|gif|stf)/i.test(name)) continue;
    for (const address of addresses) {
      if (address.internal || address.family !== "IPv4") continue;
      results.push({
        name,
        address: address.address,
        netmask: address.netmask,
        broadcast: broadcastAddress(address.address, address.netmask),
      });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

function writeAscii(buffer: Buffer, value: string, offset: number, length: number): void {
  buffer.fill(0, offset, offset + length);
  buffer.write(value.slice(0, length), offset, length, "ascii");
}

function writeHeader(
  buffer: Buffer,
  messageType: number,
  nodeId: number,
  sequence: number,
): void {
  buffer.writeUInt16LE(nodeId, 0);
  buffer.writeUInt8(3, 2);
  buffer.writeUInt8(5, 3);
  buffer.write("TCN", 4, 3, "ascii");
  buffer.writeUInt8(messageType, 7);
  writeAscii(buffer, "CASPER", 8, 8);
  buffer.writeUInt8(sequence & 0xff, 16);
  buffer.writeUInt8(NodeType.Slave, 17);
  buffer.writeUInt16LE(0, 18);
  const microseconds = Number((process.hrtime.bigint() / 1_000n) % 1_000_000n);
  buffer.writeUInt32LE(microseconds, 20);
}

export function buildTCNetOptInPacket(
  listenerPort: number,
  nodeId: number,
  sequence: number,
  uptimeSeconds: number,
): Buffer {
  const buffer = Buffer.alloc(68);
  writeHeader(buffer, TCNetMessageType.OptIn, nodeId, sequence);
  buffer.writeUInt16LE(0, 24);
  buffer.writeUInt16LE(listenerPort, 26);
  buffer.writeUInt16LE(uptimeSeconds % (12 * 60 * 60), 28);
  writeAscii(buffer, "CASPER", 32, 16);
  writeAscii(buffer, "DJ-BRIDGE", 48, 16);
  buffer.writeUInt8(1, 64);
  buffer.writeUInt8(12, 65);
  buffer.writeUInt8(0, 66);
  return buffer;
}

export function buildTCNetMetadataRequest(
  layerIndex: number,
  nodeId: number,
  sequence: number,
): Buffer {
  const buffer = Buffer.alloc(26);
  writeHeader(buffer, TCNetMessageType.Request, nodeId, sequence);
  buffer.writeUInt8(TCNetDataPacketType.MetaData, 24);
  // TCNet packets use one-based layer IDs on the wire.
  buffer.writeUInt8(layerIndex + 1, 25);
  return buffer;
}

function decodeNullTerminatedUtf32(buffer: Buffer): string {
  const characters: string[] = [];
  for (let offset = 0; offset + 3 < buffer.length; offset += 4) {
    const codePoint = buffer.readUInt32LE(offset);
    if (codePoint === 0) break;
    characters.push(
      codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : "\ufffd",
    );
  }
  return characters.join("").trim();
}

function decodeNullTerminatedUtf8(buffer: Buffer): string {
  const nullIndex = buffer.indexOf(0);
  return buffer.subarray(0, nullIndex >= 0 ? nullIndex : buffer.length).toString("utf8").trim();
}

export function parseTCNetMetadataPacket(
  buffer: Buffer,
  protocolMinor: number,
): { layerIndex: number; metadata: ShowKontrolMetadata } | null {
  if (buffer.length < 285 || buffer.readUInt8(24) !== TCNetDataPacketType.MetaData) {
    return null;
  }

  const rawLayer = buffer.readUInt8(25);
  const layerIndex = rawLayer > 0 ? rawLayer - 1 : 0;
  if (layerIndex < 0 || layerIndex > 7) return null;

  if (protocolMinor >= 5 && buffer.length >= 547) {
    return {
      layerIndex,
      metadata: {
        artist: decodeNullTerminatedUtf32(buffer.subarray(29, 285)),
        title: decodeNullTerminatedUtf32(buffer.subarray(285, 541)),
        trackID: buffer.readUInt32LE(543),
      },
    };
  }

  // TCNet versions before 3.5 use two 128-byte UTF-8 fields.
  return {
    layerIndex,
    metadata: {
      artist: decodeNullTerminatedUtf8(buffer.subarray(29, 157)),
      title: decodeNullTerminatedUtf8(buffer.subarray(157, 285)),
      trackID: buffer.length >= 291 ? buffer.readUInt32LE(287) : 0,
    },
  };
}

function parseHeader(buffer: Buffer): TCNetManagementHeader | null {
  if (buffer.length < 24) return null;
  try {
    const header = new TCNetManagementHeader(buffer);
    header.read();
    return header;
  } catch {
    return null;
  }
}

function bindSocket(socket: dgram.Socket, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      socket.off("error", onError);
      resolve();
    };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind(port, address);
  });
}

function closeSocket(socket: dgram.Socket | null): Promise<void> {
  if (!socket) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      socket.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export class ShowKontrolReader {
  private readonly playbackState: ShowKontrolPlaybackState;
  private readonly nodeId = 1 + Math.floor(Math.random() * 0xfffe);
  private sequence = 0;
  private startedAt = 0;
  private started = false;
  private controlSocket: dgram.Socket | null = null;
  private timeSocket: dgram.Socket | null = null;
  private unicastSocket: dgram.Socket | null = null;
  private unicastPort = 0;
  private senderSockets: SenderSocket[] = [];
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private master: TCNetMaster | null = null;
  private metadataRequestedAt = new Map<number, number>();
  private confirmedQueue: ConfirmedShowKontrolTrack[] = [];
  private currentTrack: ConfirmedShowKontrolTrack | null = null;
  private lastPacketAt = 0;
  private lastTimePacketAt = 0;
  private lastStatusEmitAt = 0;
  private lastError: string | null = null;
  private selectedInterfaces: ShowKontrolNetworkInterface[] = [];

  constructor(
    private readonly options: ShowKontrolReaderOptions,
    private readonly logger: ShowKontrolLogger,
  ) {
    this.playbackState = new ShowKontrolPlaybackState(
      Math.max(0, options.confirmationSeconds ?? 10) * 1_000,
      Math.max(0, options.fallbackConfirmationSeconds ?? 45) * 1_000,
    );
  }

  async start(): Promise<void> {
    if (this.started) return;

    const allInterfaces = listShowKontrolNetworkInterfaces();
    this.selectedInterfaces = this.options.networkInterface
      ? allInterfaces.filter((network) => network.name === this.options.networkInterface)
      : allInterfaces;

    if (this.selectedInterfaces.length === 0) {
      const requested = this.options.networkInterface
        ? ` "${this.options.networkInterface}"`
        : "";
      throw new Error(`No active IPv4 network interface${requested} is available for ShowKontrol.`);
    }

    this.started = true;
    this.startedAt = Date.now();
    this.lastError = null;

    try {
      this.controlSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.controlSocket.on("message", (message, remote) => this.handleControlPacket(message, remote));
      this.controlSocket.on("error", (error) => this.handleSocketError("TCNet control", error));
      await bindSocket(this.controlSocket, TCNET_CONTROL_PORT, "0.0.0.0");
      this.controlSocket.setBroadcast(true);

      this.timeSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.timeSocket.on("message", (message) => this.handleTimePacket(message));
      this.timeSocket.on("error", (error) => this.handleSocketError("TCNet timing", error));
      await bindSocket(this.timeSocket, TCNET_TIME_PORT, "0.0.0.0");

      const boundUnicast = await this.bindUnicastSocket();
      this.unicastSocket = boundUnicast.socket;
      this.unicastPort = boundUnicast.port;
      this.unicastSocket.on("message", (message, remote) => this.handleUnicastPacket(message, remote));
      this.unicastSocket.on("error", (error) => this.handleSocketError("TCNet unicast", error));
      this.unicastSocket.setBroadcast(true);

      await this.createSenderSockets();
      this.announceTimer = setInterval(() => this.tick(), 1_000);
      this.tick();

      this.logger.info("ShowKontrol TCNet reader started", {
        interfaces: this.selectedInterfaces.map((network) => `${network.name}:${network.address}`),
        unicastPort: this.unicastPort,
      });
      this.emitStatus(true);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }

    const sockets = this.senderSockets.map((sender) => closeSocket(sender.socket));
    this.senderSockets = [];
    sockets.push(closeSocket(this.controlSocket));
    sockets.push(closeSocket(this.timeSocket));
    sockets.push(closeSocket(this.unicastSocket));
    this.controlSocket = null;
    this.timeSocket = null;
    this.unicastSocket = null;
    await Promise.all(sockets);

    this.started = false;
    this.master = null;
    this.emitStatus(true);
  }

  readCurrentTrack(): TrackInfo | null {
    const queued = this.confirmedQueue.shift();
    return queued ?? this.currentTrack;
  }

  getStatus(): ShowKontrolReaderStatus {
    const now = Date.now();
    const connected = Boolean(
      this.started
      && this.master
      && now - this.master.lastSeenAt <= MASTER_STALE_MS,
    );
    const layers = this.playbackState.snapshot();
    const activeLayers = layers.filter((layer) => layer.trackId > 0 || layer.source > 0);
    const playingLayers = layers.filter((layer) => layer.state === 3 || layer.state === 4);
    const onAirAvailable = now - this.lastTimePacketAt <= MASTER_STALE_MS
      && layers.some((layer) => layer.onAir !== null);

    return {
      state: !this.started
        ? "stopped"
        : this.lastError
          ? "error"
          : connected
            ? "connected"
            : "searching",
      connected,
      masterName: this.master?.name ?? null,
      masterAddress: this.master?.address ?? null,
      networkInterfaces: this.selectedInterfaces,
      discoveredLayers: activeLayers.length,
      playingLayers: playingLayers.length,
      onAirAvailable,
      currentLayer: this.currentTrack?.sourceLayer ?? null,
      currentDeck: this.currentTrack?.sourceName ?? null,
      lastPacketAt: this.lastPacketAt > 0 ? new Date(this.lastPacketAt).toISOString() : null,
      lastError: this.lastError,
      layers,
    };
  }

  private async bindUnicastSocket(): Promise<{ socket: dgram.Socket; port: number }> {
    const range = TCNET_UNICAST_MAX - TCNET_UNICAST_MIN + 1;
    const start = TCNET_UNICAST_MIN + Math.floor(Math.random() * range);

    for (let attempt = 0; attempt < 32; attempt++) {
      const port = TCNET_UNICAST_MIN + ((start - TCNET_UNICAST_MIN + attempt) % range);
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
      try {
        await bindSocket(socket, port, "0.0.0.0");
        return { socket, port };
      } catch {
        await closeSocket(socket);
      }
    }

    throw new Error("Could not reserve a TCNet unicast port (65023-65535).");
  }

  private async createSenderSockets(): Promise<void> {
    for (const network of this.selectedInterfaces) {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      try {
        await bindSocket(socket, 0, network.address);
        socket.setBroadcast(true);
        socket.on("error", (error) => this.handleSocketError(`TCNet ${network.name}`, error));
        this.senderSockets.push({ socket, network });
      } catch (error) {
        await closeSocket(socket);
        this.logger.warn("ShowKontrol: could not use network interface", {
          interface: network.name,
          address: network.address,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (this.senderSockets.length === 0) {
      throw new Error("Could not open a UDP sender on any selected network interface.");
    }
  }

  private nextSequence(): number {
    const sequence = this.sequence;
    this.sequence = (this.sequence + 1) & 0xff;
    return sequence;
  }

  private tick(): void {
    if (!this.started || !this.unicastSocket) return;

    const now = Date.now();
    if (this.master && now - this.master.lastSeenAt > MASTER_STALE_MS) {
      this.logger.warn("ShowKontrol TCNet master became stale", {
        master: this.master.name,
        address: this.master.address,
      });
      this.master = null;
      this.metadataRequestedAt.clear();
    }

    const optIn = buildTCNetOptInPacket(
      this.unicastPort,
      this.nodeId,
      this.nextSequence(),
      Math.floor((now - this.startedAt) / 1_000),
    );

    for (const sender of this.senderSockets) {
      sender.socket.send(optIn, TCNET_CONTROL_PORT, sender.network.broadcast, (error) => {
        if (error) this.handleSocketError(`TCNet broadcast ${sender.network.name}`, error);
      });
    }

    if (this.master) {
      this.unicastSocket.send(optIn, this.master.port, this.master.address);
      for (const layer of this.playbackState.metadataNeeded()) {
        this.requestMetadata(layer, now);
      }
    }

    this.emitStatus();
  }

  private setMaster(
    address: string,
    port: number,
    nodeId: number,
    name: string,
    now: number,
  ): void {
    if (!port) return;
    const changed = !this.master
      || this.master.address !== address
      || this.master.port !== port
      || this.master.nodeId !== nodeId;

    if (changed) {
      this.logger.info("ShowKontrol TCNet master discovered", {
        name,
        address,
        port,
        nodeId,
      });
      this.metadataRequestedAt.clear();
    }

    this.master = { address, port, nodeId, name, lastSeenAt: now };
    this.lastError = null;
    this.lastPacketAt = now;
    this.emitStatus(changed);
  }

  private handleControlPacket(message: Buffer, remote: dgram.RemoteInfo): void {
    const header = parseHeader(message);
    if (!header || header.nodeId === this.nodeId) return;
    const now = Date.now();

    try {
      if (header.messageType === TCNetMessageType.OptIn && message.length >= 68) {
        const packet = new TCNetOptInPacket();
        packet.buffer = message;
        packet.header = header;
        packet.read();
        if (header.nodeType === NodeType.Master || header.nodeType === NodeType.Auto) {
          this.setMaster(
            remote.address,
            packet.nodeListenerPort,
            header.nodeId,
            packet.appName || header.nodeName || "ShowKontrol",
            now,
          );
        }
        return;
      }

      if (header.messageType === TCNetMessageType.Status && message.length >= 300) {
        const packet = new TCNetStatusPacket();
        packet.buffer = message;
        packet.header = header;
        packet.read();

        if (packet.data && (header.nodeType === NodeType.Master || !this.master)) {
          this.setMaster(
            remote.address,
            packet.data.nodeListenerPort,
            header.nodeId,
            header.nodeName || "ShowKontrol",
            now,
          );
        } else if (this.master?.nodeId === header.nodeId) {
          this.master.lastSeenAt = now;
        }

        const needed = this.playbackState.applyStatus(packet.layers, now);
        for (const layer of needed) {
          this.requestMetadata(layer, now);
        }
        this.lastPacketAt = now;
        this.emitStatus();
      }
    } catch (error) {
      this.logger.warn("ShowKontrol: ignored malformed TCNet control packet", {
        from: remote.address,
        type: header.messageType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleTimePacket(message: Buffer): void {
    const header = parseHeader(message);
    if (!header || header.messageType !== TCNetMessageType.Time) return;
    if (this.master && header.nodeId !== this.master.nodeId) return;

    try {
      const packet = new TCNetTimePacket();
      packet.buffer = message;
      packet.header = header;
      packet.read();
      const now = Date.now();
      const confirmed = this.playbackState.applyTime(packet.layers, now);
      this.lastPacketAt = now;
      this.lastTimePacketAt = now;

      for (const track of confirmed) {
        this.currentTrack = track;
        this.confirmedQueue.push(track);
        if (this.confirmedQueue.length > 8) this.confirmedQueue.shift();
        this.logger.info("ShowKontrol confirmed on-air track", {
          deck: track.sourceName,
          layer: track.sourceLayer + 1,
          artist: track.artist,
          title: track.title,
        });
        this.options.onTrack?.(track);
      }

      this.emitStatus();
    } catch (error) {
      this.logger.warn("ShowKontrol: ignored malformed TCNet timing packet", {
        length: message.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleUnicastPacket(message: Buffer, remote: dgram.RemoteInfo): void {
    const header = parseHeader(message);
    if (!header || header.nodeId === this.nodeId) return;
    const now = Date.now();

    if (header.messageType === TCNetMessageType.OptIn && message.length >= 68) {
      try {
        const packet = new TCNetOptInPacket();
        packet.buffer = message;
        packet.header = header;
        packet.read();
        if (header.nodeType === NodeType.Master || header.nodeType === NodeType.Auto) {
          this.setMaster(
            remote.address,
            packet.nodeListenerPort,
            header.nodeId,
            packet.appName || header.nodeName || "ShowKontrol",
            now,
          );
        }
      } catch {
        // A malformed discovery response should not interrupt playback.
      }
      return;
    }

    if (header.messageType !== TCNetMessageType.Data) return;
    if (this.master && header.nodeId !== this.master.nodeId) return;
    const parsed = parseTCNetMetadataPacket(message, header.minorVersion);
    if (!parsed) return;

    if (this.playbackState.applyMetadata(parsed.layerIndex, parsed.metadata, now)) {
      this.metadataRequestedAt.delete(parsed.layerIndex);
      this.lastPacketAt = now;
      this.logger.info("ShowKontrol metadata received", {
        layer: parsed.layerIndex + 1,
        trackId: parsed.metadata.trackID,
        artist: parsed.metadata.artist,
        title: parsed.metadata.title,
      });
      this.emitStatus(true);
    }
  }

  private requestMetadata(layerIndex: number, now: number): void {
    if (!this.master || !this.unicastSocket) return;
    const lastRequested = this.metadataRequestedAt.get(layerIndex) ?? 0;
    if (now - lastRequested < METADATA_RETRY_MS) return;

    const request = buildTCNetMetadataRequest(layerIndex, this.nodeId, this.nextSequence());
    this.metadataRequestedAt.set(layerIndex, now);
    this.unicastSocket.send(request, this.master.port, this.master.address, (error) => {
      if (error) {
        this.logger.warn("ShowKontrol metadata request failed", {
          layer: layerIndex + 1,
          error: error.message,
        });
      }
    });
  }

  private handleSocketError(label: string, error: Error): void {
    this.lastError = `${label}: ${error.message}`;
    this.logger.error("ShowKontrol socket error", { label, error: error.message });
    this.emitStatus(true);
  }

  private emitStatus(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastStatusEmitAt < STATUS_EMIT_MIN_MS) return;
    this.lastStatusEmitAt = now;
    this.options.onStatus?.(this.getStatus());
  }
}
