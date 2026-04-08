import { DeleteCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  // Delete associated requests in batches of 25 (DynamoDB limit)
  let deletedRequests = 0;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: env.requestsTableName,
        KeyConditionExpression: "eventId = :eid",
        ExpressionAttributeValues: { ":eid": eventId },
        ProjectionExpression: "eventId, requestId",
        ExclusiveStartKey: lastKey,
      }),
    );

    const items = result.Items ?? [];
    if (items.length > 0) {
      const chunks: typeof items[] = [];
      for (let i = 0; i < items.length; i += 25) {
        chunks.push(items.slice(i, i + 25));
      }
      for (const chunk of chunks) {
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [env.requestsTableName]: chunk.map((item) => ({
                DeleteRequest: { Key: { eventId: item.eventId, requestId: item.requestId } },
              })),
            },
          }),
        );
        deletedRequests += chunk.length;
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Delete the event itself
  await docClient.send(
    new DeleteCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
    }),
  );

  return json(200, { deleted: true, eventId, deletedRequests });
};
