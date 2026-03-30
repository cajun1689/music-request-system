import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const response = await docClient.send(
    new GetCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
    }),
  );

  if (!response.Item) {
    return json(404, { error: "Event not found" });
  }

  return json(200, response.Item);
};
