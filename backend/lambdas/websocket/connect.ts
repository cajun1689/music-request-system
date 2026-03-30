import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { docClient, env } from "../shared/utils";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) {
    return { statusCode: 400, body: "Missing connection id" };
  }

  const now = new Date().toISOString();
  const eventId = event.queryStringParameters?.eventId ?? "unsubscribed";
  const role = event.queryStringParameters?.role ?? "guest";

  await docClient.send(
    new PutCommand({
      TableName: env.connectionsTableName,
      Item: {
        connectionId,
        eventId,
        role,
        connectedAt: now,
      },
    }),
  );

  return { statusCode: 200, body: "Connected" };
};
