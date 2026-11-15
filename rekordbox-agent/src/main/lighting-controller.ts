import * as dgram from "dgram";
import * as os from "os";
import { randomBytes } from "crypto";
import { performance } from "perf_hooks";
import { LightingReply, LightingOperation, LIGHTING_REPLY_PORT, LIGHTING_COMMAND_PORT, lightingCommand, oscCommand, parseLightingReply, privateIPv4 } from "./lighting-protocol";

export interface LightingNetwork { name: string; address: string; broadcast: string; netmask: string; mac: string }
function sameSubnet(address: string, network: LightingNetwork): boolean {
  const a = address.split(".").map(Number), b = network.address.split(".").map(Number), mask = network.netmask.split(".").map(Number);
  return a.length === 4 && b.length === 4 && mask.length === 4 && a.every((octet, i) => (octet & mask[i]) === (b[i] & mask[i]));
}
export function lightingNetworks(): LightingNetwork[] {
  const result: LightingNetwork[] = [];
  for (const [name, rows] of Object.entries(os.networkInterfaces())) for (const r of rows ?? []) {
    if (r.internal || r.family !== "IPv4" || !privateIPv4(r.address) || /^(utun|awdl|llw)/.test(name)) continue;
    const a = r.address.split(".").map(Number), m = r.netmask.split(".").map(Number);
    result.push({ name, address: r.address, netmask: r.netmask, mac: r.mac,
      broadcast: a.map((v, i) => (v | (255 ^ m[i])) & 255).join(".") });
  }
  return result;
}
export interface LightingStatus {
  enabled: boolean; state: "off" | "searching" | "standby" | "ready" | "migration" | "error";
  address: string | null; station: string | null; owner: string | null; timer: boolean; colors: boolean;
  opening: boolean;
  bpm: number | null; tempoSource: string | null; a9Fresh: boolean; lastTrack: string | null; error: string | null;
}
export interface MusicConnectors { start(network: LightingNetwork): Promise<void>; stop(): Promise<void>; currentTrackKey?(): string | null }
export interface LightingControllerOptions {
  connectors: MusicConnectors;
  onStatus: (status: LightingStatus) => void;
  networkInterfaces?: () => LightingNetwork[];
  legacyNeedsMigration?: () => boolean;
  label?: string;
  replyPort?: number;
  commandPort?: number;
  socketFactory?: () => dgram.Socket;
  requestTimeoutMs?: number;
}
const id = () => randomBytes(16).toString("hex");
export class LightingController {
  readonly ownerId = id();
  private socket: dgram.Socket | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pending = new Map<string, { address: string; resolve: (r: LightingReply & { address: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private network: LightingNetwork | null = null;
  private current: LightingStatus = { enabled: false, state: "off", address: null, station: null, owner: null, timer: false, colors: false, opening: false, bpm: null, tempoSource: null, a9Fresh: false, lastTrack: null, error: null };
  private epoch = 0;
  private busy = false;
  private owned = false;
  private connectorRunning = false;
  private utilityBusy = false;
  private openingTrack: string | null = null;
  private lastTempoAt = 0;
  private lastTrackAt = -Infinity;
  constructor(private options: LightingControllerOptions) {}
  getStatus(): LightingStatus { return { ...this.current }; }
  private emit(patch: Partial<LightingStatus> = {}): void { Object.assign(this.current, patch); this.options.onStatus(this.getStatus()); }
  private networks(): LightingNetwork[] { return (this.options.networkInterfaces ?? lightingNetworks)(); }
  private async open(): Promise<void> {
    if (this.socket) return;
    const socket = (this.options.socketFactory ?? (() => dgram.createSocket("udp4")))();
    this.socket = socket;
    socket.on("message", (data, info) => {
      if (!privateIPv4(info.address)) return;
      const reply = parseLightingReply(data); if (!reply) return;
      const wait = this.pending.get(reply.nonce); if (!wait || (wait.address !== "*" && wait.address !== info.address)) return;
      this.pending.delete(reply.nonce); clearTimeout(wait.timer); wait.resolve({ ...reply, address: info.address });
    });
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { socket.removeListener("listening", ready); reject(error); };
      const ready = () => { socket.removeListener("error", fail); socket.setBroadcast(true); resolve(); };
      socket.once("error", fail); socket.once("listening", ready); socket.bind(this.options.replyPort ?? LIGHTING_REPLY_PORT);
    }).catch((e) => { try { socket.close(); } catch {} if (this.socket === socket) this.socket = null; throw e; });
    socket.on("error", (e) => { this.emit({ error: `Lighting network: ${e.message}` }); });
  }
  private request(op: LightingOperation, address: string, network: LightingNetwork, payload = "", discover = false): Promise<LightingReply & { address: string }> {
    const socket = this.socket; if (!socket) return Promise.reject(new Error("Lighting is off"));
    const nonce = id();
    const command = lightingCommand(op, this.ownerId, nonce, network.address, this.options.label ?? os.hostname(), payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(nonce); reject(new Error("MA did not acknowledge the lighting request")); }, this.options.requestTimeoutMs ?? 2500);
      this.pending.set(nonce, { address: discover ? "*" : address, resolve, reject, timer });
      socket.send(oscCommand(command), this.options.commandPort ?? LIGHTING_COMMAND_PORT, address, (error) => {
        if (error && this.pending.delete(nonce)) { clearTimeout(timer); reject(error); }
      });
    });
  }
  async find(manualAddress = ""): Promise<LightingStatus> {
    if (this.utilityBusy) throw new Error("A lighting control is still finishing");
    if (manualAddress && !privateIPv4(manualAddress)) throw new Error("Enter a private MA IPv4 address");
    if (this.current.enabled) { await this.tick(manualAddress); return this.getStatus(); }
    const epoch = ++this.epoch;
    await this.open();
    try {
      await this.discover(manualAddress, epoch);
      return this.getStatus();
    } finally { if (!this.current.enabled && epoch === this.epoch) this.closeSocket(); }
  }
  private async discover(manualAddress: string, epoch: number): Promise<boolean> {
    const networks = this.networks(); if (!networks.length) throw new Error("Connect this Mac to the DJ network");
    const targets = networks.flatMap((network) => {
      const result = [{ network, target: network.broadcast, broadcast: true }];
      const known = manualAddress || this.current.address;
      if (known && sameSubnet(known, network)) result.unshift({ network, target: known, broadcast: false });
      return result;
    });
    const attempts = targets.map(async ({ network, target, broadcast }) => {
      const reply = await this.request("hello", target, network, "", broadcast);
      // MA queues SendOSC and shares its destination row. Parallel discovery
      // can deliver a virtual-adapter nonce to the physical LAN address.
      // Select the adapter by the replying MA's subnet, not just that nonce.
      const selected = sameSubnet(reply.address, network) ? network : networks.find((candidate) => sameSubnet(reply.address, candidate));
      if (!selected) throw new Error("Connect to the same local lighting network as the booth MA");
      return { network: selected, reply };
    });
    let found: Awaited<typeof attempts[number]>;
    try { found = await Promise.any(attempts); } catch { throw new Error("MA not found. The booth needs the DJ Bridge plugin and OSC feedback setup."); }
    if (epoch !== this.epoch) return false;
    this.network = found.network;
    this.emit({ address: found.reply.address, station: found.reply.station, owner: found.reply.ownerLabel === "-" ? null : found.reply.ownerLabel,
      timer: found.reply.timer, colors: found.reply.colors, opening: found.reply.opening, error: null });
    return true;
  }
  async enable(): Promise<LightingStatus> {
    if (this.utilityBusy) throw new Error("A lighting control is still finishing");
    if (this.current.enabled) return this.getStatus();
    ++this.epoch; this.emit({ enabled: true, state: "searching", error: null });
    try { await this.open(); } catch (e) { await this.disable(); throw e; }
    this.interval = setInterval(() => void this.tick(), 4000); this.interval.unref();
    await this.tick(); return this.getStatus();
  }
  private async tick(manualAddress = ""): Promise<void> {
    if (!this.current.enabled || this.busy) return;
    this.busy = true; const epoch = this.epoch;
    try {
      if (!this.network || !this.current.address || manualAddress) await this.discover(manualAddress, epoch);
      if (epoch !== this.epoch || !this.network || !this.current.address) return;
      const reply = await this.request(this.owned ? "heartbeat" : "claim", this.current.address, this.network);
      if (epoch !== this.epoch) return;
      this.emit({ timer: reply.timer, colors: reply.colors, opening: reply.opening, owner: reply.ownerLabel, error: null });
      if (reply.owner !== this.ownerId || !["claimed", "heartbeat"].includes(reply.result)) {
        this.owned = false; await this.stopConnectors(); this.emit({ state: "standby", error: reply.result === "busy" ? null : `MA: ${reply.result}` }); return;
      }
      this.owned = true;
      if (this.options.legacyNeedsMigration?.()) { this.emit({ state: "migration" }); return; }
      if (!this.connectorRunning) {
        // Mark before awaiting so disable can stop an in-flight startup too.
        this.connectorRunning = true;
        await this.options.connectors.start(this.network);
        if (epoch !== this.epoch) { await this.stopConnectors(); return; }
      }
      if (this.current.opening && this.openingTrack === null) this.openingTrack = this.options.connectors.currentTrackKey?.() ?? null;
      this.emit({ state: "ready" });
    } catch (error) {
      if (epoch === this.epoch) {
        this.owned = false; await this.stopConnectors(); this.network = null;
        this.emit({ state: "searching", error: String((error as Error).message), bpm: null, tempoSource: null, a9Fresh: false });
      }
    } finally { this.busy = false; }
  }
  async migrated(): Promise<void> { await this.tick(); }
  async startClub(): Promise<LightingStatus> {
    if (this.utilityBusy) throw new Error("A lighting control is still finishing");
    if (!this.current.enabled) await this.enable();
    if (!this.owned || this.current.state !== "ready" || !this.network || !this.current.address) throw new Error("Connect lighting and acquire control before starting Club Night");
    const epoch = this.epoch;
    const openingTrack = this.options.connectors.currentTrackKey?.() ?? null;
    const reply = await this.request("start", this.current.address, this.network);
    if (epoch !== this.epoch) throw new Error("Lighting was disabled");
    if (reply.result !== "started") throw new Error(`MA could not start the club look: ${reply.result}`);
    this.openingTrack = openingTrack;
    this.emit({ timer: reply.timer, colors: reply.colors, opening: reply.opening }); return this.getStatus();
  }
  async control(action: "stop" | "white"): Promise<LightingStatus> {
    if (action !== "stop" && action !== "white") throw new Error("Unknown lighting control");
    if (this.utilityBusy) throw new Error("A lighting control is still finishing");
    this.utilityBusy = true;
    const temporary = !this.current.enabled;
    const epoch = temporary ? ++this.epoch : this.epoch;
    let claimed = false;
    try {
      // Steady white and blackout must also work with music connectors off.
      // Borrow a short lease without starting the receiver or its pollers.
      if (temporary) {
        await this.open();
        if (!await this.discover("", epoch)) throw new Error("Lighting connection changed");
        const claim = await this.request("claim", this.current.address!, this.network!);
        if (claim.owner !== this.ownerId || claim.result !== "claimed") throw new Error("Another DJ controls the lights. Use the booth buttons or wait for handoff.");
        claimed = true;
      } else if (!this.owned) throw new Error("Acquire lighting control first, or use the booth buttons");
      if (epoch !== this.epoch || !this.network || !this.current.address) throw new Error("Lighting connection changed");
      const reply = await this.request(action, this.current.address, this.network);
      if (epoch !== this.epoch) throw new Error("Lighting connection changed");
      if (reply.result !== (action === "stop" ? "stopped" : "white")) throw new Error(`MA: ${reply.result}`);
      this.openingTrack = null;
      this.emit({ timer: reply.timer, colors: reply.colors, opening: reply.opening, error: null });
    } finally {
      if (temporary && epoch === this.epoch) {
        if (claimed && this.network && this.current.address) await this.request("release", this.current.address, this.network).catch(() => null);
        this.closeSocket(); this.network = null; this.emit({ owner: null });
      }
      this.utilityBusy = false;
    }
    return this.getStatus();
  }
  async finishOpening(): Promise<LightingStatus> {
    if (!this.owned || !this.current.enabled || !this.network || !this.current.address) throw new Error("Connect lighting first");
    const epoch = this.epoch;
    const reply = await this.request("normal", this.current.address, this.network);
    if (epoch !== this.epoch) throw new Error("Lighting was disabled");
    if (reply.result !== "normal") throw new Error(`MA: ${reply.result}`);
    this.emit({ opening: reply.opening, timer: reply.timer, colors: reply.colors }); return this.getStatus();
  }
  musicStatus(patch: Pick<Partial<LightingStatus>, "bpm" | "tempoSource" | "a9Fresh" | "lastTrack" | "error">): void {
    if (this.current.enabled && this.owned) this.emit(patch);
  }
  tempo(bpm: number): void {
    const now = performance.now();
    if (!this.owned || !this.current.enabled || !this.network || !this.current.address || now - this.lastTempoAt < 500 || bpm < 30 || bpm > 225 || !Number.isFinite(bpm)) return;
    this.lastTempoAt = now;
    void this.request("tempo", this.current.address, this.network, bpm.toFixed(3)).catch(() => {});
  }
  track(source: "cdj" | "serato", description: string, key = description): void {
    const now = performance.now();
    if (!this.owned || !this.current.enabled || !this.network || !this.current.address || now - this.lastTrackAt < 5000) return;
    if (this.current.opening) {
      if (this.openingTrack === null) { this.openingTrack = key; this.emit({ lastTrack: "Opening song: " + description }); return; }
      if (this.openingTrack === key) return;
    }
    this.lastTrackAt = now;
    const epoch = this.epoch;
    void this.request("track", this.current.address, this.network, source).then((reply) => {
      if (epoch === this.epoch && this.current.enabled && this.owned && reply.result === "track") this.emit({ lastTrack: description, colors: reply.colors, opening: reply.opening, timer: reply.timer });
    }).catch(() => {});
  }
  private async stopConnectors(): Promise<void> {
    if (this.connectorRunning) { this.connectorRunning = false; await this.options.connectors.stop(); }
  }
  private closeSocket(): void {
    for (const wait of this.pending.values()) { clearTimeout(wait.timer); wait.reject(new Error("Lighting connection closed")); }
    this.pending.clear(); const socket = this.socket; this.socket = null; try { socket?.close(); } catch {}
  }
  async disable(): Promise<LightingStatus> {
    ++this.epoch; if (this.interval) clearInterval(this.interval); this.interval = null;
    const release = this.owned && this.network && this.current.address
      ? this.request("release", this.current.address, this.network).catch(() => null) : Promise.resolve(null);
    this.owned = false; this.emit({ enabled: false, state: "off", bpm: null, tempoSource: null, a9Fresh: false, error: null });
    await this.stopConnectors(); await release; this.network = null; this.closeSocket(); return this.getStatus();
  }
  canMigrate(): boolean { return this.owned && this.current.state === "migration"; }
  remoteUrl(): string {
    if (!this.current.address || !privateIPv4(this.current.address)) throw new Error("Find the booth MA first");
    return `http://${this.current.address}:8080/`;
  }
}
