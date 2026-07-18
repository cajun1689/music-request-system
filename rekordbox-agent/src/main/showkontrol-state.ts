import type { TrackInfo } from "./rekordbox-reader";

export const TCNET_ON_AIR_UNKNOWN = 255;
export const TCNET_LAYER_PLAYING = 3;
export const TCNET_LAYER_LOOPING = 4;

export interface ShowKontrolStatusLayer {
  source: number;
  status: number;
  trackID: number;
  name: string;
}

export interface ShowKontrolTimeLayer {
  currentTimeMillis: number;
  totalTimeMillis: number;
  state: number;
  onAir: number;
}

export interface ShowKontrolMetadata {
  trackID: number;
  title: string;
  artist: string;
}

export interface ConfirmedShowKontrolTrack extends TrackInfo {
  playbackConfirmed: true;
  sourceLayer: number;
  sourceName: string;
}

export interface ShowKontrolLayerSnapshot {
  layer: number;
  name: string;
  source: number;
  trackId: number;
  title: string;
  artist: string;
  state: number;
  onAir: boolean | null;
  positionMs: number;
  totalMs: number;
  lastPacketAt: number;
  confirmationStartedAt: number | null;
  confirmed: boolean;
}

interface MutableLayerState extends ShowKontrolLayerSnapshot {
  metadataTrackId: number;
  confirmedKey: string;
}

function isPlaying(state: number): boolean {
  return state === TCNET_LAYER_PLAYING || state === TCNET_LAYER_LOOPING;
}

function cleanMetadata(value: string): string {
  return value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
}

function playbackKey(layer: MutableLayerState): string {
  return [
    layer.layer,
    layer.trackId,
    cleanMetadata(layer.artist).toLowerCase(),
    cleanMetadata(layer.title).toLowerCase(),
  ].join(":");
}

function makeLayer(layer: number): MutableLayerState {
  return {
    layer,
    name: `Deck ${layer + 1}`,
    source: 0,
    trackId: 0,
    title: "",
    artist: "",
    state: 0,
    onAir: null,
    positionMs: 0,
    totalMs: 0,
    lastPacketAt: 0,
    confirmationStartedAt: null,
    confirmed: false,
    metadataTrackId: 0,
    confirmedKey: "",
  };
}

/**
 * Pure state machine for TCNet layer data. Network transport is intentionally
 * kept out so cue/on-air behavior can be tested deterministically.
 */
export class ShowKontrolPlaybackState {
  private readonly layers = Array.from({ length: 8 }, (_, layer) => makeLayer(layer));

  constructor(
    private confirmationMs = 10_000,
    private fallbackConfirmationMs = 45_000,
  ) {}

  setConfirmationDelays(confirmationMs: number, fallbackConfirmationMs: number): void {
    this.confirmationMs = Math.max(0, confirmationMs);
    this.fallbackConfirmationMs = Math.max(this.confirmationMs, fallbackConfirmationMs);
  }

  applyStatus(statusLayers: ShowKontrolStatusLayer[], now = Date.now()): number[] {
    const metadataNeeded: number[] = [];

    for (let index = 0; index < this.layers.length; index++) {
      const incoming = statusLayers[index];
      if (!incoming) continue;

      const layer = this.layers[index];
      const trackChanged = incoming.trackID !== layer.trackId;
      layer.name = cleanMetadata(incoming.name) || `Deck ${index + 1}`;
      layer.source = incoming.source;
      layer.state = incoming.status;
      layer.lastPacketAt = now;

      if (trackChanged) {
        layer.trackId = incoming.trackID;
        layer.title = "";
        layer.artist = "";
        layer.metadataTrackId = 0;
        layer.confirmationStartedAt = null;
        layer.confirmed = false;
        layer.confirmedKey = "";
      }

      if (layer.trackId > 0 && layer.metadataTrackId !== layer.trackId) {
        metadataNeeded.push(index);
      }
    }

    return metadataNeeded;
  }

  applyMetadata(layerIndex: number, metadata: ShowKontrolMetadata, now = Date.now()): boolean {
    const layer = this.layers[layerIndex];
    if (!layer) return false;

    // Ignore a late response for the track that was previously loaded.
    if (layer.trackId > 0 && metadata.trackID > 0 && metadata.trackID !== layer.trackId) {
      return false;
    }

    if (layer.trackId === 0 && metadata.trackID > 0) {
      layer.trackId = metadata.trackID;
    }
    layer.metadataTrackId = metadata.trackID || layer.trackId;
    layer.title = cleanMetadata(metadata.title);
    layer.artist = cleanMetadata(metadata.artist);
    layer.lastPacketAt = now;
    return Boolean(layer.title);
  }

  applyTime(timeLayers: ShowKontrolTimeLayer[], now = Date.now()): ConfirmedShowKontrolTrack[] {
    const confirmedTracks: ConfirmedShowKontrolTrack[] = [];

    for (let index = 0; index < this.layers.length; index++) {
      const incoming = timeLayers[index];
      if (!incoming) continue;

      const layer = this.layers[index];
      layer.state = incoming.state;
      layer.positionMs = incoming.currentTimeMillis;
      layer.totalMs = incoming.totalTimeMillis;
      layer.lastPacketAt = now;

      const onAirKnown = incoming.onAir !== TCNET_ON_AIR_UNKNOWN;
      layer.onAir = onAirKnown ? incoming.onAir > 0 : null;

      const eligible = isPlaying(incoming.state)
        && Boolean(layer.title)
        && layer.trackId > 0
        && (onAirKnown ? layer.onAir === true : true);

      if (!eligible) {
        layer.confirmationStartedAt = null;
        continue;
      }

      if (layer.confirmationStartedAt === null) {
        layer.confirmationStartedAt = now;
      }

      const requiredMs = onAirKnown ? this.confirmationMs : this.fallbackConfirmationMs;
      const elapsed = now - layer.confirmationStartedAt;
      const key = playbackKey(layer);
      if (elapsed < requiredMs || (layer.confirmed && layer.confirmedKey === key)) {
        continue;
      }

      layer.confirmed = true;
      layer.confirmedKey = key;
      confirmedTracks.push({
        title: layer.title,
        artist: layer.artist,
        playedAt: new Date(layer.confirmationStartedAt).toISOString(),
        playbackConfirmed: true,
        sourceLayer: index,
        sourceName: layer.name,
      });
    }

    return confirmedTracks;
  }

  metadataNeeded(): number[] {
    return this.layers
      .filter((layer) => layer.trackId > 0 && layer.metadataTrackId !== layer.trackId)
      .map((layer) => layer.layer);
  }

  snapshot(): ShowKontrolLayerSnapshot[] {
    return this.layers.map((layer) => ({
      layer: layer.layer,
      name: layer.name,
      source: layer.source,
      trackId: layer.trackId,
      title: layer.title,
      artist: layer.artist,
      state: layer.state,
      onAir: layer.onAir,
      positionMs: layer.positionMs,
      totalMs: layer.totalMs,
      lastPacketAt: layer.lastPacketAt,
      confirmationStartedAt: layer.confirmationStartedAt,
      confirmed: layer.confirmed,
    }));
  }
}
