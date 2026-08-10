import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import type { EventRecord, OrganizationRecord } from "../shared/types";
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
  const eventResult = await docClient.send(
    new GetCommand({
      TableName: env.eventsTableName,
      Key: { eventId: payload.eventId },
      ProjectionExpression: "eventId, isActive, organizationId, accountMode",
    }),
  );
  if (!eventResult.Item || eventResult.Item.isActive === false) {
    return { statusCode: 404, body: "Event not found" };
  }
  const eventRecord = eventResult.Item as EventRecord;
  if (eventRecord.accountMode === "saas" && eventRecord.organizationId) {
    const [organizationResult, connectionResult] = await Promise.all([
      docClient.send(
        new GetCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId: eventRecord.organizationId },
        }),
      ),
      docClient.send(
        new QueryCommand({
          TableName: env.connectionsTableName,
          IndexName: "eventId-index",
          KeyConditionExpression: "eventId = :eventId",
          ExpressionAttributeValues: { ":eventId": payload.eventId },
          Select: "COUNT",
        }),
      ),
    ]);
    const organization = organizationResult.Item as OrganizationRecord | undefined;
    if (!organization) return { statusCode: 404, body: "Organization not found" };
    if ((connectionResult.Count ?? 0) >= organization.entitlements.maxWebsocketConnections) {
      return { statusCode: 429, body: "Event connection limit reached" };
    }
  }
  const role = payload.role === "overlay" ? "overlay" : "guest";

  await docClient.send(
    new UpdateCommand({
      TableName: env.connectionsTableName,
      Key: { connectionId },
      UpdateExpression: "SET eventId = :eventId, #role = :role, expiresAt = :expiresAt",
      ExpressionAttributeNames: {
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":eventId": payload.eventId,
        ":role": role,
        ":expiresAt": Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      },
      ConditionExpression: "attribute_exists(connectionId)",
    }),
  );

  return { statusCode: 200, body: "Subscribed" };
};
