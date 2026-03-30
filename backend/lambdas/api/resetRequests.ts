import { BatchWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

const CHUNK_SIZE = 25;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const query = await docClient.send(
    new QueryCommand({
      TableName: env.requestsTableName,
      KeyConditionExpression: "eventId = :eventId",
      ExpressionAttributeValues: {
        ":eventId": eventId,
      },
      ProjectionExpression: "eventId, requestId",
    }),
  );

  const items = query.Items ?? [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [env.requestsTableName]: chunk.map((item) => ({
            DeleteRequest: {
              Key: {
                eventId: item.eventId,
                requestId: item.requestId,
              },
            },
          })),
        },
      }),
    );
  }

  return json(200, {
    eventId,
    deletedCount: items.length,
    message: "Requests reset for event",
  });
};
