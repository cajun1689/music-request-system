import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
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

  if (!response.Item.pushToken) {
    const newToken = randomUUID();
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: env.eventsTableName,
          Key: { eventId },
          ConditionExpression: "attribute_not_exists(pushToken) OR pushToken = :empty",
          UpdateExpression: "SET pushToken = :token",
          ExpressionAttributeValues: { ":token": newToken, ":empty": "" },
        }),
      );
      response.Item.pushToken = newToken;
    } catch {
      // Race condition or already set by another request
    }
  }

  const authHeader = event.headers?.authorization ?? event.headers?.Authorization;
  if (!authHeader) {
    const { pushToken: _stripped, autoMatchState: _match, ...publicFields } = response.Item;
    return json(200, publicFields);
  }

  return json(200, response.Item);
};
