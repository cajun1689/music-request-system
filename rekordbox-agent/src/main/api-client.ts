import { net } from "electron";
import { getApiBaseUrl, getConfig } from "./config-store";
import log from "./logger";
import type { LibraryTrack, TrackInfo } from "./rekordbox-reader";

export interface PushResult {
  matched: boolean;
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
  if (!config.eventId) {
    return {
      genreVotes: { hip_hop: 0, country: 0, edm: 0, alternative_rock: 0, total: 0 },
      fireSaleActive: false,
    };
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(config.eventId)}`;
  const response = await electronFetch(url);
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
  if (!config.eventId || !config.pushToken) {
    throw new Error("Event ID and Push Token must be configured.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(config.eventId)}/push-track`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-push-token": config.pushToken,
    },
    body: JSON.stringify({
      title: track.title,
      artist: track.artist,
      sourceId: config.sourceId || undefined,
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
  status: string;
  tipAmount?: number;
  submittedAt: string;
}

export async function fetchRequests(statusFilter?: string): Promise<RequestItem[]> {
  const config = getConfig();
  if (!config.eventId) return [];

  const baseUrl = getApiBaseUrl();
  let url = `${baseUrl}/events/${encodeURIComponent(config.eventId)}/requests`;
  if (statusFilter) {
    url += `?status=${encodeURIComponent(statusFilter)}`;
  }

  const response = await electronFetch(url);
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
  if (!config.eventId || !config.pushToken) {
    throw new Error("Event ID and Push Token must be configured.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(config.eventId)}/review-request`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-push-token": config.pushToken,
    },
    body: JSON.stringify({ requestId, status }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Review failed (${response.status}): ${text}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

export interface FireSaleResult {
  fireSaleActive: boolean;
  fireSaleMessage: string;
}

export async function toggleFireSale(active: boolean, message?: string): Promise<FireSaleResult> {
  const config = getConfig();
  if (!config.eventId || !config.pushToken) {
    throw new Error("Event ID and Push Token must be configured.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(config.eventId)}/fire-sale`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-push-token": config.pushToken,
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
  if (!config.eventId || !config.pushToken) {
    throw new Error("Event ID and Push Token must be configured.");
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/events/${encodeURIComponent(config.eventId)}/library`;

  const response = await electronFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-push-token": config.pushToken,
    },
    body: JSON.stringify({
      tracks,
      sourceId: config.sourceId || undefined,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Library sync failed (${response.status}): ${text}`);
  }

  return (await response.json()) as LibrarySyncResult;
}
