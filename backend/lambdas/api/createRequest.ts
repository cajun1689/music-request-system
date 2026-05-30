import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { moderateShoutout } from "../shared/moderateShoutout";
import type { EventRecord, GenreName, RequestRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

const s3 = new S3Client({});

interface CreateRequestInput {
  songTitle: string;
  artistName: string;
  requesterName?: string;
  message?: string;
  shoutout?: string;
  tipAmount?: number;
  venmoHandle?: string;
  paymentReference?: string;
  paymentStatus?: "unpaid" | "pending_verification";
  genre?: GenreName;
}

const VALID_GENRES: GenreName[] = ["hip_hop", "country", "edm", "alternative_rock"];

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
  const isShoutoutOnly = !input?.songTitle?.trim() && !input?.artistName?.trim() && !!input?.shoutout?.trim();

  if (!eventId || (!isShoutoutOnly && (!input?.songTitle || !input?.artistName))) {
    return json(400, { error: "eventId and (songTitle + artistName) or shoutout are required" });
  }

  const songTitle = input?.songTitle ? toTitleCase(input.songTitle) : "";
  const artistName = input?.artistName ? toTitleCase(input.artistName) : "";

  if (!isShoutoutOnly) {
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
  }

  const eventResult = await docClient.send(
    new GetCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
    }),
  );
  const eventRecord = eventResult.Item as EventRecord | undefined;

  let autoStatus: "pending" | "approved" | "vetoed" = "pending";
  let autoReviewedBy: string | undefined;
  const norm = normalize(songTitle) + normalize(artistName);

  if (!isShoutoutOnly) {
    if (eventRecord?.blockList?.length) {
      const blocked = eventRecord.blockList.some(
        (entry) => norm.includes(normalize(entry)),
      );
      if (blocked) {
        autoStatus = "vetoed";
        autoReviewedBy = "auto:blocklist";
      }
    }

    if (autoStatus === "pending" && eventRecord?.libraryOnlyMode) {
      let inLibrary = false;
      try {
        const libResponse = await s3.send(
          new GetObjectCommand({
            Bucket: env.brandAssetsBucketName,
            Key: `libraries/${eventId}.json`,
          }),
        );
        const body = await libResponse.Body?.transformToString();
        if (body) {
          const lib = JSON.parse(body) as { tracks: Array<{ titleNorm: string; artistNorm: string }> };
          inLibrary = lib.tracks.some(
            (t) => similarity(songTitle, t.titleNorm) >= 0.85 || similarity(artistName, t.artistNorm) >= 0.75,
          );
        }
      } catch {
        inLibrary = true;
      }
      if (!inLibrary) {
        autoStatus = "vetoed";
        autoReviewedBy = "auto:library-only";
      }
    }

    if (autoStatus === "pending" && eventRecord?.autoApproveList?.length) {
      const autoApproved = eventRecord.autoApproveList.some(
        (entry) => norm.includes(normalize(entry)),
      );
      if (autoApproved) {
        autoStatus = "approved";
        autoReviewedBy = "auto:auto-approve";
      }
    }
  }

  const shoutoutText = input.shoutout?.trim() || undefined;

  let shoutoutFlagged: boolean | undefined;
  let shoutoutFlagSeverity: "ok" | "warn" | "block" | undefined;
  let shoutoutFlagCategories: string[] | undefined;
  let shoutoutFlagReason: string | undefined;
  let shoutoutModeratedAt: string | undefined;
  let shoutoutAutoApproved: boolean | undefined;

  if (shoutoutText) {
    shoutoutAutoApproved = true;
    try {
      const mod = await moderateShoutout(shoutoutText, {
        djBrandName: eventRecord?.djBrandName,
        venueName: eventRecord?.venueName,
      });
      shoutoutFlagged = mod.flagged;
      shoutoutFlagSeverity = mod.severity;
      shoutoutFlagCategories = mod.categories.length ? mod.categories : undefined;
      shoutoutFlagReason = mod.reason || undefined;
      shoutoutModeratedAt = new Date().toISOString();
      if (mod.severity === "block" || mod.severity === "warn") {
        shoutoutAutoApproved = false;
      }
      console.log("createRequest: shoutout moderated", {
        eventId,
        severity: mod.severity,
        flagged: mod.flagged,
        categories: mod.categories,
        autoApproved: shoutoutAutoApproved,
      });
    } catch (err) {
      console.error("createRequest: moderation failed (failing open, auto-approving)", String(err));
    }
  }

  const requestRecord: RequestRecord = {
    eventId,
    requestId: randomUUID(),
    songTitle,
    artistName,
    requesterName: input.requesterName,
    message: input.message,
    shoutout: shoutoutText,
    genre: input.genre && VALID_GENRES.includes(input.genre) ? input.genre : undefined,
    status: autoStatus,
    paymentStatus: input.paymentStatus ?? (input.tipAmount ? "pending_verification" : "unpaid"),
    tipAmount: typeof input.tipAmount === "number" ? Number(input.tipAmount.toFixed(2)) : undefined,
    venmoHandle: input.venmoHandle?.replace("@", ""),
    paymentReference: input.paymentReference,
    position: Date.now(),
    upvotes: 0,
    reviewedBy: autoReviewedBy,
    reviewedAt: autoReviewedBy ? new Date().toISOString() : undefined,
    submittedAt: new Date().toISOString(),
    shoutoutFlagged,
    shoutoutFlagSeverity,
    shoutoutFlagCategories,
    shoutoutFlagReason,
    shoutoutModeratedAt,
    shoutoutApproved: shoutoutAutoApproved,
    shoutoutApprovedAt: shoutoutAutoApproved === true ? new Date().toISOString() : undefined,
  };

  await docClient.send(
    new PutCommand({
      TableName: env.requestsTableName,
      Item: requestRecord,
    }),
  );

  return json(201, requestRecord);
};
