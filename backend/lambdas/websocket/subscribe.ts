import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { docClient, env, parseBody } from "../shared/utils";

interface SubscribePayload {
  eventId: string;
  role?: "dj" | "overlay" | "guest";
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) {
    return { statusCode: 400, body: "Missing connection id" };
  }

  const payload = parseBody<SubscribePayload>(event.body);
  if (!payload?.eventId) {
    return { statusCode: 400, body: "eventId is required" };
  }

  await docClient.send(
    new UpdateCommand({
      TableName: env.connectionsTableName,
      Key: { connectionId },
      UpdateExpression: "SET eventId = :eventId, #role = :role",
      ExpressionAttributeNames: {
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":eventId": payload.eventId,
        ":role": payload.role ?? "guest",
      },
      ConditionExpression: "attribute_exists(connectionId)",
    }),
  );

  return { statusCode: 200, body: "Subscribed" };
};
