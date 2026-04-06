import { getApiBaseUrl, getConfig } from "./config-store";
import type { TrackInfo } from "./rekordbox-reader";

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

export async function fetchEvents(): Promise<EventSummary[]> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/events`);
  if (!response.ok) {
    throw new Error(`Failed to fetch events (${response.status})`);
  }
  const data = (await response.json()) as { events: EventSummary[] };
  return data.events ?? [];
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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-push-token": config.pushToken,
    },
    body: JSON.stringify({
      title: track.title,
      artist: track.artist,
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
