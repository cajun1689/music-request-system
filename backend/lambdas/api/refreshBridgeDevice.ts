import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createHash, randomBytes } from "node:crypto";
import { authorizeBridgeRequest } from "../shared/bridgeAuth";
import type { EventRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface RefreshDeviceInput {
  eventId: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const input = parseBody<RefreshDeviceInput>(event.body);
  const eventId = input?.eventId?.trim();
  if (!eventId) return json(400, { error: "eventId is required" });
  const eventResult = await docClient.send(
    new GetCommand({ TableName: env.eventsTableName, Key: { eventId } }),
  );
  const eventRecord = eventResult.Item as EventRecord | undefined;
  if (!eventRecord) return json(404, { error: "Event not found" });
  const authorization = await authorizeBridgeRequest(event, eventRecord);
  if (!authorization?.device) {
    return json(403, { error: "A paired Bridge device credential is required" });
  }
  const deviceToken = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: env.bridgeDevicesTableName,
      Key: { deviceId: authorization.device.deviceId },
      ConditionExpression: "#status = :active",
      UpdateExpression: "SET tokenHash = :tokenHash, updatedAt = :now, lastSeenAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":active": "active",
        ":tokenHash": createHash("sha256").update(deviceToken).digest("hex"),
        ":now": now,
      },
    }),
  );
  return json(200, { deviceId: authorization.device.deviceId, deviceToken });
};
