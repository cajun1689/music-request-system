import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { RequestRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface DetectPlayedInput {
  playedTitle: string;
  playedArtist?: string;
  sourceId?: string;
  reviewedBy?: string;
}

const REMIX_WORDS = ["remix", "mix", "edit", "version", "vip", "bootleg", "rework"];

function normalize(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/_/g, " ")
    .replace(/[^\w\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function squash(raw: string): string {
  return normalize(raw).replace(/\s+/g, "");
}

function coreTitle(raw: string): string {
  const noBrackets = raw.replace(/\((.*?)\)|\[(.*?)\]/g, " ");
  const stripped = REMIX_WORDS.reduce((acc, word) => acc.replace(new RegExp(`\\b${word}\\b`, "gi"), " "), noBrackets);
  return normalize(stripped);
}

function remixTag(raw: string): string {
  const match = raw.match(/\((.*?)\)|\[(.*?)\]/g)?.join(" ") ?? "";
  const normalized = normalize(match || raw);
  return REMIX_WORDS.some((word) => normalized.includes(word)) ? normalized : "";
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function containsAllTokens(haystack: Set<string>, needle: Set<string>): boolean {
  if (!needle.size) return false;
  return [...needle].every((token) => haystack.has(token));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) {
    return 0;
  }
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function scoreMatch(request: RequestRecord, playedTitle: string, playedArtist?: string): number {
  const requestTitle = request.songTitle ?? "";
  const requestArtist = request.artistName ?? "";
  const playedTitleNorm = normalize(playedTitle);
  const requestTitleNorm = normalize(requestTitle);

  let score = 0;
  if (playedTitleNorm === requestTitleNorm) {
    score += 100;
  }
  if (coreTitle(playedTitle) === coreTitle(requestTitle)) {
    score += 50;
  }
  const playedCore = coreTitle(playedTitle);
  const requestCore = coreTitle(requestTitle);
  const playedCoreSquashed = squash(playedCore);
  const requestCoreSquashed = squash(requestCore);
  if (
    requestCoreSquashed.length >= 6
    && playedCoreSquashed
    && playedCoreSquashed.includes(requestCoreSquashed)
    && playedCore !== requestCore
  ) {
    score += 55;
  }

  const playedTokens = tokens(playedCore);
  const requestTokens = tokens(requestCore);
  if (containsAllTokens(playedTokens, requestTokens)) {
    score += 40;
  }
  const requestTokenList = [...requestTokens];
  if (
    requestTokenList.length === 1
    && requestTokenList[0].length >= 4
    && playedTokens.has(requestTokenList[0])
  ) {
    score += 15;
  }

  score += jaccard(playedTokens, requestTokens) * 40;

  const playedRemix = remixTag(playedTitle);
  const requestRemix = remixTag(requestTitle);
  if (playedRemix && requestRemix && playedRemix === requestRemix) {
    score += 20;
  }

  if (playedArtist) {
    const pa = normalize(playedArtist);
    const ra = normalize(requestArtist);
    if (pa === ra) {
      score += 25;
    } else if (pa && ra && (pa.includes(ra) || ra.includes(pa))) {
      score += 15;
    } else {
      score -= 10;
    }
  }

  return score;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }
  const input = parseBody<DetectPlayedInput>(event.body);
  if (!input?.playedTitle?.trim()) {
    return json(400, { error: "playedTitle is required" });
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
    return json(200, { matched: false, reason: "No approved requests available" });
  }

  const ranked = candidates
    .map((request) => ({ request, score: scoreMatch(request, input.playedTitle, input.playedArtist) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 55) {
    return json(200, {
      matched: false,
      reason: "No strong title match",
      topCandidates: ranked.slice(0, 3).map((entry) => ({
        requestId: entry.request.requestId,
        songTitle: entry.request.songTitle,
        artistName: entry.request.artistName,
        score: Number(entry.score.toFixed(2)),
      })),
    });
  }

  const now = new Date().toISOString();
  const reviewedBy = input.reviewedBy ?? `auto:${input.sourceId ?? "manual"}`;
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
        ":reviewedBy": reviewedBy,
        ":playedAt": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, {
    matched: true,
    sourceId: input.sourceId ?? "manual",
    confidenceScore: Number(best.score.toFixed(2)),
    request: updated.Attributes,
  });
};
