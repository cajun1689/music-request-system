import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface ToggleFireSaleInput {
  active: boolean;
  message?: string;
}

const DEFAULT_MESSAGE =
  "\u{1F525}\u{1F525}\u{1F525} FIRE SALE \u{1F525}\u{1F525}\u{1F525}  $1 SHOTS \u{1F943}\u{1F943}  Bartender's Choice - Until The End Of This Song";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) return json(400, { error: "eventId is required" });

  const pushToken =
    event.headers?.["x-push-token"] ?? event.headers?.["X-Push-Token"] ?? "";
  if (!pushToken) return json(401, { error: "Missing x-push-token header" });

  const input = parseBody<ToggleFireSaleInput>(event.body);
  if (input?.active === undefined) {
    return json(400, { error: "active (boolean) is required" });
  }

  const eventResponse = await docClient.send(
    new GetCommand({ TableName: env.eventsTableName, Key: { eventId } }),
  );
  const eventRecord = eventResponse.Item as EventRecord | undefined;
  if (!eventRecord) return json(404, { error: "Event not found" });

  if (!eventRecord.pushToken || eventRecord.pushToken !== pushToken) {
    return json(403, { error: "Invalid push token" });
  }

  const now = new Date().toISOString();
  const fireSaleMessage = input.active
    ? (input.message?.trim() || DEFAULT_MESSAGE)
    : "";

  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      UpdateExpression:
        "SET #fsa = :active, #fsm = :message, updatedAt = :now",
      ExpressionAttributeNames: {
        "#fsa": "fireSaleActive",
        "#fsm": "fireSaleMessage",
      },
      ExpressionAttributeValues: {
        ":active": input.active,
        ":message": fireSaleMessage,
        ":now": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, {
    fireSaleActive: result.Attributes?.fireSaleActive,
    fireSaleMessage: result.Attributes?.fireSaleMessage,
  });
};
