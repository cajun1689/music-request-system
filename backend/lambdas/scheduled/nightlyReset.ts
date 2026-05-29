import { QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { EventBridgeHandler } from "aws-lambda";
import type { EventRecord, GenreVotes } from "../shared/types";
import { docClient, env } from "../shared/utils";

const ZERO_GENRE_VOTES: GenreVotes = {
  hip_hop: 0,
  country: 0,
  edm: 0,
  alternative_rock: 0,
};

function mountainHour(): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/Denver",
  }).format(new Date());
  return Number(hour);
}

async function listEventsToReset(): Promise<EventRecord[]> {
  const events: EventRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: env.eventsTableName,
        FilterExpression: "#active = :true OR isRecurring = :true",
        ExpressionAttributeNames: { "#active": "isActive" },
        ExpressionAttributeValues: { ":true": true },
        ExclusiveStartKey,
      }),
    );
    events.push(...((result.Items ?? []) as EventRecord[]));
    ExclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return events;
}

async function archiveActiveRequests(eventId: string, now: string): Promise<number> {
  let archivedCount = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: env.requestsTableName,
        KeyConditionExpression: "eventId = :eventId",
        FilterExpression: "#status <> :archived",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":eventId": eventId,
          ":archived": "archived",
        },
        ProjectionExpression: "eventId, requestId, #status",
        ExclusiveStartKey,
      }),
    );

    for (const item of result.Items ?? []) {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: env.requestsTableName,
            Key: { eventId: item.eventId, requestId: item.requestId },
            UpdateExpression: "SET #status = :archived, archivedAt = :now, previousStatus = :prev",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":archived": "archived",
              ":now": now,
              ":prev": item.status ?? "pending",
            },
          }),
        );
        archivedCount++;
      } catch (err) {
        console.error("nightlyReset: failed to archive request", {
          eventId,
          requestId: item.requestId,
          error: String(err),
        });
      }
    }

    ExclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return archivedCount;
}

async function resetGenreVotes(eventId: string, now: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      ConditionExpression: "attribute_exists(eventId)",
      UpdateExpression:
        "SET genreVotes = :genreVotes, genreVotesTotal = :genreVotesTotal, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":genreVotes": ZERO_GENRE_VOTES,
        ":genreVotesTotal": 0,
        ":updatedAt": now,
      },
    }),
  );
}

export const handler: EventBridgeHandler<"Scheduled Event", unknown, void> = async () => {
  const hour = mountainHour();
  if (hour !== 4) {
    console.log("nightlyReset: skipping outside 4am Mountain", { mountainHour: hour });
    return;
  }

  const now = new Date().toISOString();
  const eventsToReset = await listEventsToReset();
  console.log("nightlyReset: starting", {
    eventCount: eventsToReset.length,
    eventIds: eventsToReset.map((event) => event.eventId),
  });

  let totalArchived = 0;
  for (const event of eventsToReset) {
    const archivedCount = await archiveActiveRequests(event.eventId, now);
    await resetGenreVotes(event.eventId, now);
    totalArchived += archivedCount;
    console.log("nightlyReset: event complete", {
      eventId: event.eventId,
      archivedCount,
    });
  }

  console.log("nightlyReset: complete", {
    eventCount: eventsToReset.length,
    totalArchived,
  });
};
