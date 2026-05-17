import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AutoMatchSourceState, EventRecord } from "./types";
import { docClient, env } from "./utils";

// Average pop song is ~3 min, but we want the request to flip to "played"
// well before the next track even starts so the queue stays tidy.
export const DEFAULT_PENDING_PLAYED_MAX_AGE_MS = 90 * 1000;

export interface FinalizeOptions {
  maxAgeMs?: number;
  reason?: string;
  /** Pre-loaded event record. If omitted, the caller should be giving us the latest state already. */
}

/**
 * Walks every source on the event's autoMatchState, finalises any
 * pendingPlayedRequestId whose match is older than `maxAgeMs`.
 *
 * Returns the list of requestIds that were finalised.
 */
export async function finalizeStalePendingPlayed(
  eventRecord: EventRecord,
  options: FinalizeOptions = {},
): Promise<string[]> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_PENDING_PLAYED_MAX_AGE_MS;
  const now = Date.now();
  const ams = eventRecord.autoMatchState ?? {};
  const finalised: string[] = [];

  for (const [sourceId, state] of Object.entries(ams) as Array<[string, AutoMatchSourceState]>) {
    const requestId = state?.pendingPlayedRequestId;
    if (!requestId) continue;

    const ageReference = state.pendingPlayedMatchedAt ?? state.lastMatchedAt;
    const matchedAtMs = ageReference ? Date.parse(ageReference) : NaN;
    if (Number.isNaN(matchedAtMs)) continue;

    const ageMs = now - matchedAtMs;
    if (ageMs < maxAgeMs) continue;

    const nowIso = new Date().toISOString();
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: env.requestsTableName,
          Key: { eventId: eventRecord.eventId, requestId },
          ConditionExpression:
            "attribute_exists(eventId) and attribute_exists(requestId) and #status = :approved",
          UpdateExpression: "SET #status = :played, playedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":played": "played",
            ":approved": "approved",
            ":now": nowIso,
          },
          ReturnValues: "NONE",
        }),
      );
      finalised.push(requestId);
      console.log("finalizePendingPlayed:", {
        eventId: eventRecord.eventId,
        sourceId,
        requestId,
        ageSeconds: Math.round(ageMs / 1000),
        reason: options.reason ?? "stale",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ConditionalCheckFailed means the request already moved on (vetoed / played / archived).
      // That's fine — clear the pending entry anyway.
      if (!message.includes("ConditionalCheckFailed")) {
        console.warn("finalizePendingPlayed: update failed", {
          eventId: eventRecord.eventId,
          sourceId,
          requestId,
          error: message,
        });
      }
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: env.eventsTableName,
          Key: { eventId: eventRecord.eventId },
          UpdateExpression:
            "REMOVE #ams.#sid.#ppri, #ams.#sid.#pprb, #ams.#sid.#ppma",
          ExpressionAttributeNames: {
            "#ams": "autoMatchState",
            "#sid": sourceId,
            "#ppri": "pendingPlayedRequestId",
            "#pprb": "pendingPlayedReviewedBy",
            "#ppma": "pendingPlayedMatchedAt",
          },
        }),
      );
      if (eventRecord.autoMatchState?.[sourceId]) {
        delete eventRecord.autoMatchState[sourceId].pendingPlayedRequestId;
        delete eventRecord.autoMatchState[sourceId].pendingPlayedReviewedBy;
        delete eventRecord.autoMatchState[sourceId].pendingPlayedMatchedAt;
      }
    } catch (err) {
      console.warn("finalizePendingPlayed: failed to clear pending markers", {
        eventId: eventRecord.eventId,
        sourceId,
        error: String(err),
      });
    }
  }

  return finalised;
}
