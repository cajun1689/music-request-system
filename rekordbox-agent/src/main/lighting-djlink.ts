const MAGIC = Buffer.from("Qspt1WmJOL");
const PLAYER_CHANNELS: Record<number, number> = { 1: 2, 2: 3 };

export interface LightingDeck {
  player: number;
  identity: string | null;
  playing: boolean;
  reportedOnAir: boolean;
  master: boolean;
  mixerChannel: number | null;
  onAir: boolean;
  updatedAt: number;
}

export function parseCDJStatus(packet: Buffer): Omit<LightingDeck, "mixerChannel" | "onAir" | "updatedAt"> | null {
  if (packet.length < 148 || !packet.subarray(0, 10).equals(MAGIC) || packet[10] !== 10) return null;
  const player = packet[33];
  if (player < 1 || player > 6) return null;
  const source = packet[40], slot = packet[41], type = packet[42], track = packet.readUInt32BE(44);
  const valid = [1, 2, 3, 4, 7, 9, 14].includes(slot) && [1, 2, 5, 6].includes(type) && track !== 0;
  return { player, identity: valid ? `${source}:${slot}:${type}:${track}` : null,
    playing: [3, 4].includes(packet[123]) && (packet.length < 212 || Boolean(packet[137] & 64)),
    reportedOnAir: Boolean(packet[137] & 8), master: Boolean(packet[137] & 32) };
}

export function parseA9Channels(packet: Buffer): number[] | null {
  if (packet.length < 45 || !packet.subarray(0, 10).equals(MAGIC) || packet[10] !== 3
    || packet.subarray(11, 31).toString("ascii").replace(/\0.*$/, "") !== "DJM-A9") return null;
  return [1, 2, 3, 4].filter((channel) => packet[35 + channel] !== 0);
}

export function parseDJBeat(packet: Buffer): { player: number; bpm: number } | null {
  if (packet.length < 96 || !packet.subarray(0, 10).equals(MAGIC) || packet[10] !== 40) return null;
  const model = packet.subarray(11, 31).toString("ascii");
  if (!/^(CDJ-|XDJ-)/.test(model) || packet[33] < 1 || packet[33] > 6) return null;
  const raw = packet.readUInt16BE(90), pitch = packet.readUInt32BE(84);
  const bpm = raw / 100 * pitch / 1048576;
  if (raw === 65535 || !Number.isFinite(bpm) || bpm < 30 || bpm > 300) return null;
  return { player: packet[33], bpm };
}

export function buildDJAnnouncement(address: string, mac: string, player: number): Buffer {
  if (player < 7 || player > 15) throw new Error("Lighting observer must use device 7–15");
  const bytes = mac.split(":").map((v) => Number.parseInt(v, 16));
  const ip = address.split(".").map(Number);
  if (bytes.length !== 6 || ip.length !== 4 || [...bytes, ...ip].some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error("Invalid observer interface");
  const packet = Buffer.alloc(54);
  MAGIC.copy(packet); packet[10] = 6; packet.write("DJ Bridge Lights", 12, "ascii");
  Buffer.from([1, 2, 0, 54, player, 1]).copy(packet, 32);
  Buffer.from(bytes).copy(packet, 38); Buffer.from(ip).copy(packet, 44);
  packet[48] = 2; packet[52] = 1; packet[53] = 100;
  return packet;
}

/** No output is produced by this state machine. All timing uses monotonic milliseconds. */
export class LightingDJState {
  private channels: number[] = [];
  private channelsAt = -Infinity;
  private last = new Map<number, string | null>();
  private pending = new Map<number, { identity: string; since: number }>();
  private decks = new Map<number, LightingDeck>();
  private beats = new Map<number, { bpm: number; at: number }>();

  updateChannels(packet: Buffer, now: number): boolean {
    const channels = parseA9Channels(packet);
    if (!channels) return false;
    this.channels = channels; this.channelsAt = now;
    return true;
  }

  updateDeck(packet: Buffer, now: number): LightingDeck | null {
    const parsed = parseCDJStatus(packet);
    if (!parsed) return null;
    const mixerChannel = PLAYER_CHANNELS[parsed.player] ?? null;
    const onAir = mixerChannel === null ? parsed.reportedOnAir
      : now - this.channelsAt < 3000 && this.channels.includes(mixerChannel);
    const deck = { ...parsed, mixerChannel, onAir, updatedAt: now };
    this.decks.set(deck.player, deck);
    if (!this.last.has(deck.player)) {
      this.last.set(deck.player, deck.playing && deck.onAir ? deck.identity : null);
      return null;
    }
    if (deck.identity === null) { this.last.set(deck.player, null); this.pending.delete(deck.player); return null; }
    if (!deck.playing || !deck.onAir || deck.identity === this.last.get(deck.player)) { this.pending.delete(deck.player); return null; }
    const previous = this.pending.get(deck.player);
    if (!previous || previous.identity !== deck.identity) { this.pending.set(deck.player, { identity: deck.identity, since: now }); return null; }
    if (now - previous.since < 2000) return null;
    this.last.set(deck.player, deck.identity); this.pending.delete(deck.player);
    return deck;
  }

  updateBeat(packet: Buffer, now: number): void {
    const beat = parseDJBeat(packet);
    if (beat) this.beats.set(beat.player, { bpm: beat.bpm, at: now });
  }

  tempo(now: number): number | null {
    if (now - this.channelsAt >= 3000) return null;
    const audible = [...this.decks.values()].filter((d) => now - d.updatedAt < 3000 && d.playing
      && d.mixerChannel !== null && this.channels.includes(d.mixerChannel));
    audible.sort((a, b) => Number(b.master) - Number(a.master) || a.player - b.player);
    for (const deck of audible) {
      const beat = this.beats.get(deck.player);
      if (beat && now - beat.at < 3000) return beat.bpm;
    }
    return null;
  }

  snapshot(now: number): { channels: number[]; a9Fresh: boolean; decks: LightingDeck[] } {
    return { channels: [...this.channels], a9Fresh: now - this.channelsAt < 3000,
      decks: [...this.decks.values()].map((d) => ({ ...d, onAir: now - this.channelsAt < 3000
        && now - d.updatedAt < 3000 && (d.mixerChannel === null ? d.reportedOnAir : this.channels.includes(d.mixerChannel)) })) };
  }
}
