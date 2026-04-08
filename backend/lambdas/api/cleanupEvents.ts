import { ScanCommand, DeleteCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, env } from "../shared/utils";

const DAYS_TO_KEEP = 3;

export const handler = async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_TO_KEEP);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const result = await docClient.send(
    new ScanCommand({
      TableName: env.eventsTableName,
      ProjectionExpression: "eventId, #d, isRecurring, #n",
      ExpressionAttributeNames: { "#d": "date", "#n": "name" },
    }),
  );

  const events = result.Items ?? [];
  let deleted = 0;

  for (const evt of events) {
    if (evt.isRecurring) continue;

    const eventDate = (evt.date as string) ?? "";
    if (!eventDate || eventDate > cutoffStr) continue;

    console.log(`Cleaning up expired event: ${evt.name} (${evt.eventId}), date=${eventDate}`);

    // Delete associated requests
    let lastKey: Record<string, unknown> | undefined;
    do {
      const reqResult = await docClient.send(
        new QueryCommand({
          TableName: env.requestsTableName,
          KeyConditionExpression: "eventId = :eid",
          ExpressionAttributeValues: { ":eid": evt.eventId },
          ProjectionExpression: "eventId, requestId",
          ExclusiveStartKey: lastKey,
        }),
      );

      const items = reqResult.Items ?? [];
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25);
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [env.requestsTableName]: chunk.map((item) => ({
                DeleteRequest: { Key: { eventId: item.eventId, requestId: item.requestId } },
              })),
            },
          }),
        );
      }
      lastKey = reqResult.LastEvaluatedKey;
    } while (lastKey);

    await docClient.send(
      new DeleteCommand({
        TableName: env.eventsTableName,
        Key: { eventId: evt.eventId },
      }),
    );
    deleted++;
  }

  console.log(`Cleanup complete. Deleted ${deleted} expired events.`);
  return { deleted };
};
