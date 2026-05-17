import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { finalizeStalePendingPlayed } from "../shared/finalizePendingPlayed";
import type { EventRecord } from "../shared/types";
import { docClient, env } from "../shared/utils";

/**
 * Runs on a fixed schedule (EventBridge) to finalise any pending-played matches
 * that the in-flow finalizers haven't caught yet (e.g. when a DJ stops pushing
 * tracks before the next song starts).
 */
export const handler = async (): Promise<{ scannedEvents: number; finalisedRequests: number }> => {
  console.log("sweepPendingPlayed: starting");

  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let scannedEvents = 0;
  let finalisedRequests = 0;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: env.eventsTableName,
        ProjectionExpression: "eventId, autoMatchState",
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const record = item as Pick<EventRecord, "eventId" | "autoMatchState">;
      if (!record.eventId || !record.autoMatchState) continue;
      const hasPending = Object.values(record.autoMatchState).some(
        (state) => state?.pendingPlayedRequestId,
      );
      if (!hasPending) continue;
      scannedEvents++;
      try {
        const finalised = await finalizeStalePendingPlayed(record as EventRecord, {
          reason: "scheduled-sweep",
        });
        finalisedRequests += finalised.length;
      } catch (err) {
        console.warn("sweepPendingPlayed: event sweep failed", {
          eventId: record.eventId,
          error: String(err),
        });
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  console.log("sweepPendingPlayed: done", { scannedEvents, finalisedRequests });
  return { scannedEvents, finalisedRequests };
};
