import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const now = new Date().toISOString();

  const query = await docClient.send(
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
    }),
  );

  const items = query.Items ?? [];
  if (!items.length) {
    return json(200, { eventId, archivedCount: 0, message: "No active requests to archive." });
  }

  let archivedCount = 0;
  for (const item of items) {
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
      console.error("resetRequests: failed to archive request", {
        requestId: item.requestId, error: String(err),
      });
    }
  }

  console.log("resetRequests: archived", { eventId, archivedCount, total: items.length });

  return json(200, {
    eventId,
    archivedCount,
    message: `Archived ${archivedCount} requests. Analytics data preserved.`,
  });
};
