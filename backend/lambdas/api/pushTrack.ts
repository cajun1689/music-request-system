import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { cleanTrackName } from "../shared/cleanTrackName";
import type { EventRecord, NowPlayingSlot, RequestRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface PushTrackInput {
  title: string;
  artist?: string;
  sourceId?: string;
}

const REMIX_WORDS = ["remix", "mix", "edit", "version", "vip", "bootleg", "rework"];

const DJ_POOL_TAGS = [
  "dirty", "clean", "explicit", "radio edit",
  "quick hit", "quick hitter", "short edit",
  "intro", "outro", "intro edit", "outro edit",
  "instrumental", "acapella", "acap",
  "funkymix", "x-mix", "xtendz",
  "transition", "re-drum", "redrum", "hype",
  "ck cut", "dj edit", "dj tool",
];

const DJ_POOL_RE = new RegExp(
  "\\b(" + DJ_POOL_TAGS.join("|") + ")\\b", "gi",
);

function normalize(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripDjPoolTags(raw: string): string {
  let s = raw;
  s = s.replace(/^\d{1,3}\s+/, "");
  s = s.replace(DJ_POOL_RE, " ");
  s = s.replace(/\b(?:by\s+\w[\w\s]{0,25})$/i, "");
  s = s.replace(/\s+(?:ft\.?|feat\.?|featuring)\s+/gi, " ");
  return s.replace(/\s{2,}/g, " ").trim();
}

function coreTitle(raw: string): string {
  const noBrackets = raw.replace(/\((.*?)\)|\[(.*?)\]/g, " ");
  const stripped = REMIX_WORDS.reduce(
    (acc, word) => acc.replace(new RegExp(`\\b${word}\\b`, "gi"), " "),
    noBrackets,
  );
  return normalize(stripDjPoolTags(stripped));
}

function remixTag(raw: string): string {
  const match = raw.match(/\((.*?)\)|\[(.*?)\]/g)?.join(" ") ?? "";
  const normalized = normalize(match || raw);
  return REMIX_WORDS.some((word) => normalized.includes(word)) ? normalized : "";
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function coreTokens(value: string): Set<string> {
  return new Set(normalize(stripDjPoolTags(value)).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function containsAllTokens(haystack: Set<string>, needle: Set<string>): boolean {
  if (!needle.size) return false;
  return [...needle].every((t) => haystack.has(t));
}

function scoreMatch(request: RequestRecord, playedTitle: string, playedArtist?: string): number {
  const requestTitle = request.songTitle ?? "";
  const requestArtist = request.artistName ?? "";
  const playedTitleNorm = normalize(playedTitle);
  const requestTitleNorm = normalize(requestTitle);
  const playedCore = coreTitle(playedTitle);
  const requestCore = coreTitle(requestTitle);

  let score = 0;

  if (playedTitleNorm === requestTitleNorm) score += 100;
  else if (playedCore === requestCore) score += 80;

  const playedCoreTokens = coreTokens(playedTitle);
  const requestCoreTokens = coreTokens(requestTitle);

  if (containsAllTokens(playedCoreTokens, requestCoreTokens)) score += 40;
  else if (containsAllTokens(requestCoreTokens, playedCoreTokens)) score += 30;

  score += jaccard(playedCoreTokens, requestCoreTokens) * 40;

  const playedRemix = remixTag(playedTitle);
  const requestRemix = remixTag(requestTitle);
  if (playedRemix && requestRemix && playedRemix === requestRemix) score += 20;

  if (playedArtist) {
    const pa = normalize(stripDjPoolTags(playedArtist));
    const ra = normalize(requestArtist);
    if (pa && ra && pa === ra) {
      score += 25;
    } else if (pa && ra) {
      const paTokens = new Set(pa.split(" ").filter(Boolean));
      const raTokens = new Set(ra.split(" ").filter(Boolean));
      if (containsAllTokens(paTokens, raTokens) || containsAllTokens(raTokens, paTokens)) {
        score += 20;
      } else if (pa.includes(ra) || ra.includes(pa)) {
        score += 15;
      } else {
        score -= 5;
      }
    }
  }

  return score;
}

const DEFAULT_PUSH_SOURCE_ID = "rekordbox-push";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) return json(400, { error: "eventId is required" });

  const pushToken =
    event.headers?.["x-push-token"] ?? event.headers?.["X-Push-Token"] ?? "";
  if (!pushToken) return json(401, { error: "Missing x-push-token header" });

  const input = parseBody<PushTrackInput>(event.body);
  if (!input?.title?.trim()) return json(400, { error: "title is required" });

  const eventResponse = await docClient.send(
    new GetCommand({ TableName: env.eventsTableName, Key: { eventId } }),
  );
  const eventRecord = eventResponse.Item as EventRecord | undefined;
  if (!eventRecord) return json(404, { error: "Event not found" });

  if (!eventRecord.pushToken || eventRecord.pushToken !== pushToken) {
    return json(403, { error: "Invalid push token" });
  }

  const PUSH_SOURCE_ID = input.sourceId?.trim() || DEFAULT_PUSH_SOURCE_ID;

  const matchingSource = (eventRecord.livePlaylistSources ?? []).find(
    (s) => s.id === PUSH_SOURCE_ID || s.id === "rekordbox",
  );
  const sourceDjName = matchingSource?.djName || matchingSource?.name || PUSH_SOURCE_ID;

  const trackNorm = normalize(`${input.artist ?? ""} ${input.title}`);
  const lastPushed = eventRecord.autoMatchState?.[PUSH_SOURCE_ID]?.lastPushedTrackNorm
    ?? eventRecord.autoMatchState?.[PUSH_SOURCE_ID]?.lastMatchedTrackNorm;
  if (trackNorm && lastPushed && trackNorm === lastPushed) {
    return json(200, { matched: false, reason: "Duplicate track, already processed." });
  }

  console.log("pushTrack:", JSON.stringify({
    title: input.title, artist: input.artist, sourceId: PUSH_SOURCE_ID,
    coreTitle: coreTitle(input.title),
    coreArtist: input.artist ? normalize(stripDjPoolTags(input.artist)) : undefined,
  }));

  const approved = await docClient.send(
    new QueryCommand({
      TableName: env.requestsTableName,
      IndexName: "eventId-status-index",
      KeyConditionExpression: "eventId = :eventId and #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":eventId": eventId, ":status": "approved" },
    }),
  );
  const candidates = (approved.Items ?? []) as RequestRecord[];
  console.log("approved candidates:", candidates.length);

  const now = new Date().toISOString();

  try {
    if (!eventRecord.autoMatchState) {
      await docClient.send(
        new UpdateCommand({
          TableName: env.eventsTableName,
          Key: { eventId },
          UpdateExpression: "SET #ams = if_not_exists(#ams, :emptyMap)",
          ExpressionAttributeNames: { "#ams": "autoMatchState" },
          ExpressionAttributeValues: { ":emptyMap": {} },
        }),
      );
    }
    if (!eventRecord.autoMatchState?.[PUSH_SOURCE_ID]) {
      await docClient.send(
        new UpdateCommand({
          TableName: env.eventsTableName,
          Key: { eventId },
          UpdateExpression: "SET #ams.#sid = if_not_exists(#ams.#sid, :emptyMap)",
          ExpressionAttributeNames: { "#ams": "autoMatchState", "#sid": PUSH_SOURCE_ID },
          ExpressionAttributeValues: { ":emptyMap": {} },
        }),
      );
    }
    await docClient.send(
      new UpdateCommand({
        TableName: env.eventsTableName,
        Key: { eventId },
        UpdateExpression:
          "SET #ams.#sid.#lptn = :tn, updatedAt = :now",
        ExpressionAttributeNames: {
          "#ams": "autoMatchState",
          "#sid": PUSH_SOURCE_ID,
          "#lptn": "lastPushedTrackNorm",
        },
        ExpressionAttributeValues: { ":tn": trackNorm, ":now": now },
      }),
    );
  } catch {
    // Non-fatal
  }

  if (eventRecord.nowPlayingAutoEnabled) {
    try {
      const djBrand = eventRecord.djBrandName || "DJ";
      const rawDisplay = [input.title, input.artist].filter(Boolean).join(" - ");
      const cleaned = await cleanTrackName(rawDisplay, djBrand);
      const existingSlots: NowPlayingSlot[] = eventRecord.nowPlayingSlots ?? [];
      const slotId = `src-${PUSH_SOURCE_ID}`;
      const updatedSlots = existingSlots.filter((s) => s.id !== slotId);
      updatedSlots.push({
        id: slotId,
        djName: sourceDjName,
        songTitle: cleaned,
        active: true,
        updatedAt: now,
      });
      await docClient.send(
        new UpdateCommand({
          TableName: env.eventsTableName,
          Key: { eventId },
          UpdateExpression: "SET #nps = :slots, updatedAt = :now",
          ExpressionAttributeNames: { "#nps": "nowPlayingSlots" },
          ExpressionAttributeValues: { ":slots": updatedSlots, ":now": now },
        }),
      );
    } catch {
      // Non-fatal: now-playing update shouldn't break push flow
    }
  }

  if (!candidates.length) {
    return json(200, {
      matched: false,
      reason: "No approved requests to match.",
      pushedTrack: { title: input.title, artist: input.artist },
    });
  }

  const ranked = candidates
    .map((r) => ({ request: r, score: scoreMatch(r, input.title, input.artist) }))
    .sort((a, b) => b.score - a.score);

  console.log("scores:", JSON.stringify(
    ranked.slice(0, 5).map((e) => ({
      song: e.request.songTitle, artist: e.request.artistName,
      score: Number(e.score.toFixed(2)),
    })),
  ));

  const best = ranked[0];
  if (!best || best.score < 55) {
    return json(200, {
      matched: false,
      reason: "No strong title match",
      pushedTrack: { title: input.title, artist: input.artist },
      topCandidates: ranked.slice(0, 3).map((e) => ({
        requestId: e.request.requestId,
        songTitle: e.request.songTitle,
        artistName: e.request.artistName,
        score: Number(e.score.toFixed(2)),
      })),
    });
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: env.eventsTableName,
        Key: { eventId },
        UpdateExpression:
          "SET #fireSaleActive = :off, #fireSaleMessage = :empty, updatedAt = :now",
        ExpressionAttributeNames: {
          "#fireSaleActive": "fireSaleActive",
          "#fireSaleMessage": "fireSaleMessage",
        },
        ExpressionAttributeValues: { ":off": false, ":empty": "", ":now": now },
      }),
    );
  } catch {
    // Non-fatal
  }

  console.log("MATCH:", JSON.stringify({
    requestId: best.request.requestId,
    requestSong: best.request.songTitle,
    requestArtist: best.request.artistName,
    score: Number(best.score.toFixed(2)),
  }));

  const updated = await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId: best.request.requestId },
      ConditionExpression: "attribute_exists(eventId) and attribute_exists(requestId)",
      UpdateExpression:
        "SET #status = :status, reviewedAt = :reviewedAt, reviewedBy = :reviewedBy, playedAt = :playedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "played",
        ":reviewedAt": now,
        ":reviewedBy": `auto:${PUSH_SOURCE_ID}:${sourceDjName}`,
        ":playedAt": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: env.eventsTableName,
        Key: { eventId },
        UpdateExpression:
          "SET #ams.#sid.#lmtn = :tn, #ams.#sid.#lma = :now",
        ExpressionAttributeNames: {
          "#ams": "autoMatchState",
          "#sid": PUSH_SOURCE_ID,
          "#lmtn": "lastMatchedTrackNorm",
          "#lma": "lastMatchedAt",
        },
        ExpressionAttributeValues: { ":tn": trackNorm, ":now": now },
      }),
    );
  } catch {
    // Non-fatal
  }

  return json(200, {
    matched: true,
    sourceId: PUSH_SOURCE_ID,
    sourceName: sourceDjName,
    confidenceScore: Number(best.score.toFixed(2)),
    pushedTrack: { title: input.title, artist: input.artist },
    request: updated.Attributes,
  });
};
