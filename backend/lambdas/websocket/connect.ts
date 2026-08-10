import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import type { EventRecord, OrganizationRecord } from "../shared/types";
import { docClient, env } from "../shared/utils";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) {
    return { statusCode: 400, body: "Missing connection id" };
  }

  const now = new Date().toISOString();
  const eventId = event.queryStringParameters?.eventId ?? "unsubscribed";
  const role = event.queryStringParameters?.role === "dashboard" ? "dashboard" : "guest";
  if (eventId !== "unsubscribed") {
    const eventResult = await docClient.send(
      new GetCommand({
        TableName: env.eventsTableName,
        Key: { eventId },
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
            ExpressionAttributeValues: { ":eventId": eventId },
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
  }

  await docClient.send(
    new PutCommand({
      TableName: env.connectionsTableName,
      Item: {
        connectionId,
        eventId,
        role,
        connectedAt: now,
        expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      },
    }),
  );

  return { statusCode: 200, body: "Connected" };
};
