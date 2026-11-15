import * as dgram from "dgram";
import { accessSync, constants } from "fs";
import { spawn, ChildProcess } from "child_process";
import { performance } from "perf_hooks";
import { createInterface } from "readline";
import { LightingDJState, buildDJAnnouncement } from "./lighting-djlink";
import { LightingNetwork, MusicConnectors } from "./lighting-controller";
import { privateIPv4 } from "./lighting-protocol";
import { LightingSeratoReader } from "./lighting-serato";

interface Options {
  helperPath: string;
  onTempo: (bpm: number) => void;
  onTrack: (source: "cdj" | "serato", description: string, key: string) => void;
  onStatus: (s: { bpm?: number | null; tempoSource?: string | null; a9Fresh?: boolean; error?: string | null }) => void;
  legacySerato?: () => Promise<{ title: string; artist: string } | null> | { title: string; artist: string } | null;
}
export class LightingConnectors implements MusicConnectors {
  private sockets: dgram.Socket[] = [];
  private child: ChildProcess | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private retries = new Set<ReturnType<typeof setTimeout>>();
  private epoch = 0;
  private running = false;
  private currentNative: () => string | null = () => null;
  private seratoRunning = false;
  private serato: LightingSeratoReader | null = null;
  constructor(private options: Options) {}
  private async bind(port: number): Promise<dgram.Socket> {
    const socket = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject); socket.bind(port, () => { socket.removeListener("error", reject); resolve(); });
    }).catch((e) => { try { socket.close(); } catch {} throw e; });
    socket.on("error", (e) => this.options.onStatus({ error: `DJ network: ${e.message}` }));
    this.sockets.push(socket); return socket;
  }
  async start(network: LightingNetwork): Promise<void> {
    await this.stop(); const epoch = ++this.epoch; this.running = true;
    const current = () => this.running && epoch === this.epoch;
    const state = new LightingDJState();
    this.currentNative = () => {
      const now = performance.now();
      const deck = state.snapshot(now).decks.filter(d => now - d.updatedAt < 3000 && d.playing && d.onAir && d.identity).sort((a,b) => Number(b.master)-Number(a.master))[0];
      return deck ? `cdj:${deck.player}:${deck.identity}` : null;
    };
    const occupied = new Map<number, number>(); let observer: number | null = null;
    let usbTempo: { bpm: number; at: number } | null = null;
    let capture = false, helperError: string | null = null;
    const beatPacket = (payload: Buffer) => { const now = performance.now(); state.updateChannels(payload, now); state.updateBeat(payload, now); };
    try {
      try { accessSync(this.options.helperPath, constants.X_OK); }
      catch { throw new Error("Bundled A9 receiver is missing. Reinstall DJ Bridge."); }
      const announce = await this.bind(50000); if (!current()) { await this.stop(); return; }
      const updates = await this.bind(50002); if (!current()) { await this.stop(); return; }
      updates.setBroadcast(true);
      announce.on("message", (p, info) => {
        if (!current() || info.address === network.address || !privateIPv4(info.address)) return;
        if (p.length >= 54 && p.subarray(0, 10).toString() === "Qspt1WmJOL" && p[10] === 6) {
          occupied.set(p[36], performance.now()); if (observer === p[36]) observer = null;
        }
      });
      updates.on("message", (p, info) => {
        if (!current() || !privateIPv4(info.address) || info.address === network.address) return;
        const deck = state.updateDeck(p, performance.now());
        if (deck) this.options.onTrack("cdj", `CDJ ${deck.player} → A9 channel ${deck.mixerChannel}`, `cdj:${deck.player}:${deck.identity}`);
      });
      try {
        const beats = await this.bind(50001);
        beats.on("message", (p, info) => { if (current() && privateIPv4(info.address)) beatPacket(p); });
      } catch (e: any) { if (e.code !== "EADDRINUSE") throw e; capture = true; }
      if (!current()) { await this.stop(); return; }
      const launch = () => {
        if (!current()) return;
        helperError = null;
        const child = spawn(this.options.helperPath, capture ? ["--capture", network.name] : [], { stdio: ["ignore", "pipe", "pipe"] });
        this.child = child;
        const lines = createInterface({ input: child.stdout! });
        lines.on("line", (line) => {
          if (!current() || line.length > 4096) return;
          try {
            const event = JSON.parse(line);
            if (event.type === "serato") this.seratoRunning = event.running === true;
            if (event.type === "tempo" && Number.isFinite(event.bpm) && event.bpm >= 30 && event.bpm <= 300) usbTempo = { bpm: event.bpm, at: performance.now() };
            if (event.type === "packet" && typeof event.payload === "string" && privateIPv4(event.source)) beatPacket(Buffer.from(event.payload, "base64"));
            if (event.type === "error" && typeof event.message === "string") { helperError = event.message.slice(0, 300); this.options.onStatus({ error: helperError }); }
          } catch { /* ignore malformed helper output */ }
        });
        child.stderr?.on("data", () => {});
        child.on("error", () => { if (current()) { helperError = "Bundled A9 receiver could not start. Reinstall DJ Bridge."; this.options.onStatus({ error: helperError }); } });
        child.on("close", () => {
          lines.close(); if (this.child === child) this.child = null;
          if (!current()) return;
          usbTempo = null; this.options.onStatus({ error: "A9 receiver disconnected; reconnecting" });
          const retry = setTimeout(() => { this.retries.delete(retry); launch(); }, 3000); retry.unref(); this.retries.add(retry);
        });
      };
      launch();
      this.serato = new LightingSeratoReader((key) => { if (current()) this.options.onTrack("serato", "Serato played-track history", key); }, this.options.legacySerato);
      const started = performance.now();
      const presence = setInterval(() => {
        if (!current() || performance.now() - started < 8000) return;
        if (observer === null) observer = Array.from({ length: 9 }, (_, i) => i + 7).find((n) => performance.now() - (occupied.get(n) ?? -Infinity) > 10000) ?? null;
        if (observer !== null) updates.send(buildDJAnnouncement(network.address, network.mac, observer), 50000, network.broadcast);
      }, 1500);
      const music = setInterval(() => {
        if (!current()) return;
        const now = performance.now(), snapshot = state.snapshot(now);
        const usb = usbTempo !== null && now - usbTempo.at < 3000;
        const bpm = usb ? usbTempo!.bpm : state.tempo(now);
        const source = bpm === null ? null : usb ? "A9 USB" : "Native CDJ";
        this.options.onStatus({ bpm, tempoSource: source, a9Fresh: snapshot.a9Fresh,
          error: bpm !== null && bpm > 225 ? "Tempo exceeds MA's 225 BPM limit" : helperError });
        if (bpm !== null) this.options.onTempo(bpm);
      }, 500);
      const history = setInterval(() => { if (current()) void this.serato?.poll().catch(() => {}); }, 1000);
      this.timers.push(presence, music, history); this.timers.forEach((t) => t.unref());
      await this.serato.poll();
    } catch (error) { await this.stop(); throw error; }
  }
  currentTrackKey(): string | null { return this.currentNative() ?? (this.seratoRunning ? this.serato?.currentTrackKey() ?? null : null); }
  async stop(): Promise<void> {
    this.running = false; ++this.epoch; this.currentNative = () => null; this.seratoRunning = false;
    this.timers.forEach(clearInterval); this.timers = [];
    this.retries.forEach(clearTimeout); this.retries.clear();
    this.serato?.close(); this.serato = null;
    for (const socket of this.sockets) { try { socket.close(); } catch {} } this.sockets = [];
    const child = this.child; this.child = null;
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const kill = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 1500);
        child.once("exit", () => { clearTimeout(kill); resolve(); });
        child.kill("SIGTERM");
      });
    }
  }
}
