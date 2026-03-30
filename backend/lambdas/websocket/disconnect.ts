import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { docClient, env } from "../shared/utils";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) {
    return { statusCode: 400, body: "Missing connection id" };
  }

  await docClient.send(
    new DeleteCommand({
      TableName: env.connectionsTableName,
      Key: { connectionId },
    }),
  );

  return { statusCode: 200, body: "Disconnected" };
};
