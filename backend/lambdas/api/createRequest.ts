import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import type { RequestRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface CreateRequestInput {
  songTitle: string;
  artistName: string;
  requesterName?: string;
  message?: string;
  tipAmount?: number;
  venmoHandle?: string;
  paymentReference?: string;
  paymentStatus?: "unpaid" | "pending_verification";
}

function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toTitleCase(value: string): string {
  const lower = normalizeSpacing(value).toLowerCase();
  return lower.replace(/(^|[\s\-\/('"])([a-z])/g, (_match, prefix: string, char: string) => `${prefix}${char.toUpperCase()}`);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (!na.length || !nb.length) return 0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  let matches = 0;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

function isDuplicate(
  incoming: { songTitle: string; artistName: string },
  existing: { songTitle: string; artistName: string },
): boolean {
  const titleScore = similarity(incoming.songTitle, existing.songTitle);
  const artistScore = similarity(incoming.artistName, existing.artistName);
  return titleScore >= 0.85 && artistScore >= 0.75;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const input = parseBody<CreateRequestInput>(event.body);
  if (!eventId || !input?.songTitle || !input?.artistName) {
    return json(400, { error: "eventId, songTitle and artistName are required" });
  }

  const songTitle = toTitleCase(input.songTitle);
  const artistName = toTitleCase(input.artistName);

  const [pendingResult, approvedResult] = await Promise.all([
    docClient.send(
      new QueryCommand({
        TableName: env.requestsTableName,
        IndexName: "eventId-status-index",
        KeyConditionExpression: "eventId = :eid AND #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":eid": eventId, ":status": "pending" },
      }),
    ),
    docClient.send(
      new QueryCommand({
        TableName: env.requestsTableName,
        IndexName: "eventId-status-index",
        KeyConditionExpression: "eventId = :eid AND #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":eid": eventId, ":status": "approved" },
      }),
    ),
  ]);

  const activeRequests = [
    ...(pendingResult.Items ?? []),
    ...(approvedResult.Items ?? []),
  ] as RequestRecord[];

  const duplicate = activeRequests.find((req) =>
    isDuplicate({ songTitle, artistName }, req),
  );

  if (duplicate) {
    return json(409, {
      error: "A similar song has already been requested",
      existingRequest: {
        songTitle: duplicate.songTitle,
        artistName: duplicate.artistName,
        status: duplicate.status,
      },
    });
  }

  const requestRecord: RequestRecord = {
    eventId,
    requestId: randomUUID(),
    songTitle,
    artistName,
    requesterName: input.requesterName,
    message: input.message,
    status: "pending",
    paymentStatus: input.paymentStatus ?? (input.tipAmount ? "pending_verification" : "unpaid"),
    tipAmount: typeof input.tipAmount === "number" ? Number(input.tipAmount.toFixed(2)) : undefined,
    venmoHandle: input.venmoHandle?.replace("@", ""),
    paymentReference: input.paymentReference,
    position: Date.now(),
    submittedAt: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: env.requestsTableName,
      Item: requestRecord,
    }),
  );

  return json(201, requestRecord);
};
