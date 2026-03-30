import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord, LivePlaylistSource, RequestRecord } from "../shared/types";
import { docClient, env, json } from "../shared/utils";

const REMIX_WORDS = ["remix", "mix", "edit", "version", "vip", "bootleg", "rework"];

function normalize(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function coreTitle(raw: string): string {
  const noBrackets = raw.replace(/\((.*?)\)|\[(.*?)\]/g, " ");
  const stripped = REMIX_WORDS.reduce((acc, word) => acc.replace(new RegExp(`\\b${word}\\b`, "gi"), " "), noBrackets);
  return normalize(stripped);
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function stripHtml(html: string): string {
  return normalize(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " "),
  );
}

function containsRemixToken(raw: string): boolean {
  const norm = normalize(raw);
  return REMIX_WORDS.some((word) => norm.includes(word));
}

function scoreRequestInPage(request: RequestRecord, pageText: string): { score: number; artistMatch: boolean; remixMatch: boolean } {
  const title = request.songTitle ?? "";
  const artist = request.artistName ?? "";
  if (!title.trim()) {
    return { score: 0, artistMatch: false, remixMatch: false };
  }

  const titleNorm = normalize(title);
  const coreNorm = coreTitle(title);
  const artistNorm = normalize(artist);
  const remixMatch = containsRemixToken(title) && REMIX_WORDS.some((token) => pageText.includes(token));
  const artistMatch = Boolean(artistNorm && pageText.includes(artistNorm));
  const titleMatch = pageText.includes(titleNorm) || (coreNorm && coreNorm !== titleNorm && pageText.includes(coreNorm));
  let score = 0;

  if (pageText.includes(titleNorm)) {
    score += 95;
  }
  if (coreNorm && coreNorm !== titleNorm && pageText.includes(coreNorm)) {
    score += 35;
  }
  if (artistMatch) {
    score += 20;
  }
  if (remixMatch) {
    score += 15;
  }

  // Boost if title appears near common "now playing" language.
  const phrase = titleNorm.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (phrase) {
    const nowPlayingRegex = new RegExp(`(now playing|currently playing|current track).{0,140}${phrase}`, "i");
    if (nowPlayingRegex.test(pageText)) {
      score += 30;
    }
  }

  if (titleMatch && (artistMatch || remixMatch)) {
    score += 25;
  }

  return { score, artistMatch, remixMatch };
}

function extractCurrentTrack(html: string): string {
  const match = html.match(/playlist-trackname[^>]*>\s*([^<]+)\s*</i);
  return match ? decodeEntities(match[1]).trim() : "";
}

type PlaylistFetchResult = {
  ok: boolean;
  html: string;
  text: string;
  currentTrack: string;
  health: "live" | "private" | "no_track_data" | "unreachable";
  detail?: string;
};

async function fetchPlaylist(url: string): Promise<PlaylistFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DJMusicRequestBot/1.0)",
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        html: "",
        text: "",
        currentTrack: "",
        health: "unreachable",
        detail: `HTTP ${response.status}`,
      };
    }
    const html = await response.text();
    const text = stripHtml(html);
    const currentTrack = extractCurrentTrack(html);
    const privateMode = /currently private|only visible to you and serato/i.test(html);
    const health: PlaylistFetchResult["health"] = privateMode
      ? "private"
      : currentTrack
        ? "live"
        : "no_track_data";
    return { ok: true, html, text, currentTrack, health };
  } catch {
    return {
      ok: false,
      html: "",
      text: "",
      currentTrack: "",
      health: "unreachable",
      detail: "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const eventResponse = await docClient.send(
    new GetCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
    }),
  );
  const eventRecord = eventResponse.Item as EventRecord | undefined;
  if (!eventRecord) {
    return json(404, { error: "Event not found" });
  }

  const sources =
    (eventRecord.livePlaylistSources ?? []).filter(
      (source: LivePlaylistSource) => Boolean(source.active && source.url),
    ) ?? [];
  if (!sources.length) {
    return json(200, { matched: false, reason: "No active live playlist sources configured." });
  }

  const approved = await docClient.send(
    new QueryCommand({
      TableName: env.requestsTableName,
      IndexName: "eventId-status-index",
      KeyConditionExpression: "eventId = :eventId and #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":eventId": eventId,
        ":status": "approved",
      },
    }),
  );
  const candidates = (approved.Items ?? []) as RequestRecord[];
  if (!candidates.length) {
    return json(200, { matched: false, reason: "No approved requests to match." });
  }

  const checks: Array<{
    sourceId: string;
    sourceName: string;
    request: RequestRecord;
    score: number;
    currentTrackNorm: string;
    currentTrack: string;
  }> = [];
  const sourceStatuses: Array<{
    sourceId: string;
    sourceName: string;
    health: "live" | "private" | "no_track_data" | "unreachable";
    detail?: string;
    currentTrack?: string;
  }> = [];

  for (const source of sources) {
    const fetched = await fetchPlaylist(source.url);
    sourceStatuses.push({
      sourceId: source.id,
      sourceName: source.name,
      health: fetched.health,
      detail: fetched.detail,
      currentTrack: fetched.currentTrack || undefined,
    });
    if (!fetched.ok) {
      continue;
    }

    const currentTrackNorm = normalize(fetched.currentTrack);
    const lastMatchedTrackNorm = eventRecord.autoMatchState?.[source.id]?.lastMatchedTrackNorm;
    if (currentTrackNorm && lastMatchedTrackNorm && currentTrackNorm === lastMatchedTrackNorm) {
      continue;
    }

    for (const request of candidates) {
      const scoring = scoreRequestInPage(request, fetched.text);
      const score = scoring.score;
      if (!scoring.artistMatch && !scoring.remixMatch) {
        continue;
      }
      if (score > 0) {
        checks.push({
          sourceId: source.id,
          sourceName: source.name,
          request,
          score,
          currentTrackNorm,
          currentTrack: fetched.currentTrack,
        });
      }
    }
  }

  if (!checks.length) {
    return json(200, {
      matched: false,
      reason: "No confident matches found in live playlists.",
      sourceStatuses,
    });
  }

  checks.sort((a, b) => b.score - a.score);
  const best = checks[0];
  if (!best || best.score < 95) {
    return json(200, {
      matched: false,
      reason: "No strong confidence match found.",
      sourceStatuses,
      topCandidates: checks.slice(0, 3).map((entry) => ({
        sourceId: entry.sourceId,
        sourceName: entry.sourceName,
        requestId: entry.request.requestId,
        songTitle: entry.request.songTitle,
        artistName: entry.request.artistName,
        score: entry.score,
      })),
    });
  }

  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      UpdateExpression:
        "SET #autoMatchState.#sourceId.#lastMatchedTrackNorm = :trackNorm, #autoMatchState.#sourceId.#lastMatchedAt = :lastMatchedAt, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#autoMatchState": "autoMatchState",
        "#sourceId": best.sourceId,
        "#lastMatchedTrackNorm": "lastMatchedTrackNorm",
        "#lastMatchedAt": "lastMatchedAt",
      },
      ExpressionAttributeValues: {
        ":trackNorm": best.currentTrackNorm || normalize(best.request.songTitle),
        ":lastMatchedAt": now,
        ":updatedAt": now,
      },
    }),
  );

  const updated = await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId: best.request.requestId },
      ConditionExpression: "attribute_exists(eventId) and attribute_exists(requestId)",
      UpdateExpression: "SET #status = :status, reviewedAt = :reviewedAt, reviewedBy = :reviewedBy, playedAt = :playedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "played",
        ":reviewedAt": now,
        ":reviewedBy": `auto:${best.sourceId}`,
        ":playedAt": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, {
    matched: true,
    sourceId: best.sourceId,
    sourceName: best.sourceName,
    confidenceScore: best.score,
    sourceStatuses,
    currentTrack: best.currentTrack || undefined,
    request: updated.Attributes,
  });
};
