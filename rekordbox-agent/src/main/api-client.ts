import { net } from "electron";
import { getApiBaseUrl, getConfig, getEffectivePushSourceId } from "./config-store";
import {
  getBridgeAuthHeaders,
  getEffectiveEventId,
  hasBridgeCredential,
} from "./bridge-auth";
import log from "./logger";
import type { LibraryTrack, TrackInfo } from "./rekordbox-reader";

export interface PushResult {
  matched: boolean;
  playbackConfirmed?: boolean;
  confidenceScore?: number;
  reason?: string;
  pushedTrack?: { title: string; artist?: string };
  request?: Record<string, unknown>;
  topCandidates?: Array<{
    requestId: string;
    songTitle: string;
    artistName: string;
    score: number;
  }>;
}

export interface EventSummary {
  eventId: string;
  name: string;
  venueName?: string;
  date?: string;
  djBrandName?: string;
}

export interface EventSource {
  id: string;
  name: string;
  type: string;
  djName?: string;
  url?: string;
}

export interface PairDeviceResult {
  deviceId: string;
  deviceToken: string;
  organizationId: string;
  eventId: string;
  sourceId: string;
  eventName: string;
  organizationName: string;
}

async function electronFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  try {
    return await net.fetch(url, options);
  } catch (err) {
    log.warn("net.fetch failed, falling back to global fetch:", String(err));
    return await globalThis.fetch(url, options);
  }
}

export interface PingResult {
  status: "active" | "blocked" | "reconnected";
  sourceId: string;
  sourceName?: string;
  lastPushedAt?: string | null;
  message: string;
}

export async function pairDevice(code: string, deviceName: string): Promise<PairDeviceResult> {
  const pairingCode = code.trim();
  if (!pairingCode) {
    throw new Error("Pairing code is required.");
  }

  const response = await electronFetch(`${getApiBaseUrl()}/bridge/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: pairingCode,
      deviceName: deviceName.trim() || undefined,
      platform: process.platform,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Pairing failed (${response.status}): ${text}`);
  }

  const result = (await response.json()) as Partial<PairDeviceResult>;
  const required: Array<keyof PairDeviceResult> = [
    "deviceId",
    "deviceToken",
    "organizationId",
    "eventId",
    "sourceId",
    "eventName",
    "organizationName",
  ];
  if (required.some((key) => typeof result[key] !== "string" || !result[key]?.trim())) {
    throw new Error("Pairing response was missing required device or event information.");
  }
  return result as PairDeviceResult;
}

export async function unpairDevice(): Promise<boolean> {
  const config = getConfig();
  if (!config.deviceId || !config.deviceToken) return true;
  const response = await electronFetch(`${getApiBaseUrl()}/bridge/unpair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getBridgeAuthHeaders(config),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Remote unpair failed (${response.status}): ${text}`);
  }
  return true;
}

export async function testConnection(forceReconnect = false): Promise<PingResult> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId || !hasBridgeCredential(config)) {
    throw new Error("Pair this device or configure an Event ID and Push Token.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}/ping-source`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getBridgeAuthHeaders(config),
    },
    body: JSON.stringify({
      sourceId: getEffectivePushSourceId(config) || undefined,
      forceReconnect,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Connection test failed (${response.status}): ${text}`);
  }

  return (await response.json()) as PingResult;
}

export async function fetchEvents(): Promise<EventSummary[]> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events`;
  log.info("Fetching events from:", url);
  const response = await electronFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch events (${response.status})`);
  }
  const data = (await response.json()) as { events: EventSummary[] };
  log.info("Fetched", data.events?.length ?? 0, "events");
  return data.events ?? [];
}

export async function fetchEventSources(eventId: string): Promise<EventSource[]> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}`;
  const response = await electronFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch event details (${response.status})`);
  }
  const data = (await response.json()) as { livePlaylistSources?: EventSource[] };
  return data.livePlaylistSources ?? [];
}

export interface GenreVotesData {
  hip_hop: number;
  country: number;
  edm: number;
  alternative_rock: number;
  total: number;
}

export interface EventStatusData {
  genreVotes: GenreVotesData;
  fireSaleActive: boolean;
}

export async function fetchEventStatus(): Promise<EventStatusData> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId) {
    return {
      genreVotes: { hip_hop: 0, country: 0, edm: 0, alternative_rock: 0, total: 0 },
      fireSaleActive: false,
    };
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}`;
  const response = await electronFetch(url, {
    headers: getBridgeAuthHeaders(config),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch event (${response.status})`);
  }
  const data = (await response.json()) as {
    genreVotes?: { hip_hop?: number; country?: number; edm?: number; alternative_rock?: number };
    genreVotesTotal?: number;
    fireSaleActive?: boolean;
  };
  const v = data.genreVotes ?? {};
  const votes: GenreVotesData = {
    hip_hop: Number(v.hip_hop ?? 0),
    country: Number(v.country ?? 0),
    edm: Number(v.edm ?? 0),
    alternative_rock: Number(v.alternative_rock ?? 0),
    total: 0,
  };
  votes.total = Number(data.genreVotesTotal ?? votes.hip_hop + votes.country + votes.edm + votes.alternative_rock);
  return {
    genreVotes: votes,
    fireSaleActive: Boolean(data.fireSaleActive),
  };
}

export async function fetchGenreVotes(): Promise<GenreVotesData> {
  const result = await fetchEventStatus();
  return result.genreVotes;
}

const pendingQueue: Array<{ track: TrackInfo; retries: number }> = [];
const MAX_RETRIES = 5;

export async function pushTrack(track: TrackInfo): Promise<PushResult> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId || !hasBridgeCredential(config)) {
    throw new Error("Pair this device or configure an Event ID and Push Token.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}/push-track`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getBridgeAuthHeaders(config),
    },
    body: JSON.stringify({
      title: track.title,
      artist: track.artist,
      sourceId: track.pushSourceId || getEffectivePushSourceId(config) || undefined,
      playbackConfirmed: track.playbackConfirmed === true,
      sourceLayer: track.sourceLayer,
      sourceName: track.sourceName,
      sourceAliasId: track.sourceAliasId,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Push failed (${response.status}): ${text}`);
  }

  return (await response.json()) as PushResult;
}

export function enqueueTrack(track: TrackInfo): void {
  if (pendingQueue.length >= 50) {
    pendingQueue.shift();
  }
  pendingQueue.push({ track, retries: 0 });
}

export async function drainQueue(): Promise<PushResult[]> {
  const results: PushResult[] = [];
  const remaining: typeof pendingQueue = [];

  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift()!;
    try {
      const result = await pushTrack(item.track);
      results.push(result);
    } catch {
      item.retries++;
      if (item.retries < MAX_RETRIES) {
        remaining.push(item);
      }
    }
  }

  pendingQueue.push(...remaining);
  return results;
}

export function queueSize(): number {
  return pendingQueue.length;
}

export interface RequestItem {
  requestId: string;
  eventId: string;
  songTitle: string;
  artistName: string;
  requesterName?: string;
  message?: string;
  shoutout?: string;
  shoutoutApproved?: boolean;
  shoutoutFlagged?: boolean;
  shoutoutFlagSeverity?: "ok" | "warn" | "block";
  shoutoutFlagCategories?: string[];
  shoutoutFlagReason?: string;
  status: string;
  paymentStatus?: string;
  tipAmount?: number;
  genre?: string;
  genreLabel?: string;
  preferredGenre?: string;
  requestGenre?: string;
  position?: number;
  submittedAt: string;
}

export async function fetchRequests(statusFilter?: string): Promise<RequestItem[]> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId) return [];

  const baseUrl = getApiBaseUrl();
  let url = `${baseUrl}/events/${encodeURIComponent(eventId)}/requests`;
  if (statusFilter) {
    url += `?status=${encodeURIComponent(statusFilter)}`;
  }

  const response = await electronFetch(url, {
    headers: getBridgeAuthHeaders(config),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch requests (${response.status})`);
  }
  return (await response.json()) as RequestItem[];
}

export async function reviewRequest(
  requestId: string,
  status: "approved" | "vetoed" | "played",
): Promise<Record<string, unknown>> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId || !hasBridgeCredential(config)) {
    throw new Error("Pair this device or configure an Event ID and Push Token.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}/review-request`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getBridgeAuthHeaders(config),
    },
    body: JSON.stringify({ requestId, status }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Review failed (${response.status}): ${text}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

export async function approveShoutout(
  requestId: string,
  approved: boolean,
  autoStatus?: "played" | "vetoed",
): Promise<Record<string, unknown>> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId || !hasBridgeCredential(config)) {
    throw new Error("Pair this device or configure an Event ID and Push Token.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}/review-request`;

  const body: Record<string, unknown> = { requestId, shoutoutApproved: approved };
  if (autoStatus) {
    body.status = autoStatus;
  }

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getBridgeAuthHeaders(config),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Shoutout review failed (${response.status}): ${text}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

export interface FireSaleResult {
  fireSaleActive: boolean;
  fireSaleMessage: string;
}

export async function toggleFireSale(active: boolean, message?: string): Promise<FireSaleResult> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId || !hasBridgeCredential(config)) {
    throw new Error("Pair this device or configure an Event ID and Push Token.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}/fire-sale`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getBridgeAuthHeaders(config),
    },
    body: JSON.stringify({ active, message }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Fire sale toggle failed (${response.status}): ${text}`);
  }

  return (await response.json()) as FireSaleResult;
}

export interface LibrarySyncResult {
  trackCount: number;
  message: string;
}

export async function syncLibrary(tracks: LibraryTrack[]): Promise<LibrarySyncResult> {
  const config = getConfig();
  const eventId = getEffectiveEventId(config);
  if (!eventId || !hasBridgeCredential(config)) {
    throw new Error("Pair this device or configure an Event ID and Push Token.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(eventId)}/library`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getBridgeAuthHeaders(config),
    },
    body: JSON.stringify({
      tracks,
      sourceId: getEffectivePushSourceId(config) || undefined,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Library sync failed (${response.status}): ${text}`);
  }

  return (await response.json()) as LibrarySyncResult;
}
