import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface PingInput {
  sourceId?: string;
  forceReconnect?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) return json(400, { error: "eventId is required" });

  const pushToken =
    event.headers?.["x-push-token"] ?? event.headers?.["X-Push-Token"] ?? "";
  if (!pushToken) return json(401, { error: "Missing x-push-token header" });

  const input = parseBody<PingInput>(event.body) ?? {};
  const sourceId = input.sourceId?.trim() || "rekordbox-push";

  const eventResponse = await docClient.send(
    new GetCommand({ TableName: env.eventsTableName, Key: { eventId } }),
  );
  const eventRecord = eventResponse.Item as EventRecord | undefined;
  if (!eventRecord) {
    return json(404, { error: "Event not found" });
  }

  if (!eventRecord.pushToken || eventRecord.pushToken !== pushToken) {
    return json(403, { error: "Invalid push token" });
  }

  const blocked = eventRecord.blockedPushSources ?? [];
  const isBlocked = blocked.includes(sourceId);

  if (isBlocked && input.forceReconnect) {
    const nextBlocked = blocked.filter((s) => s !== sourceId);
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: env.eventsTableName,
          Key: { eventId },
          UpdateExpression: "SET #bps = :bps, updatedAt = :now",
          ExpressionAttributeNames: { "#bps": "blockedPushSources" },
          ExpressionAttributeValues: {
            ":bps": nextBlocked,
            ":now": new Date().toISOString(),
          },
        }),
      );
      console.log("pingSource: force-reconnected", { eventId, sourceId });
      return json(200, {
        status: "reconnected",
        sourceId,
        message: "Source has been reconnected. Track pushes will resume.",
      });
    } catch (err) {
      console.error("pingSource: failed to unblock source", {
        eventId,
        sourceId,
        error: String(err),
      });
      return json(500, { error: "Failed to reconnect source" });
    }
  }

  if (isBlocked) {
    return json(200, {
      status: "blocked",
      sourceId,
      message: "This source is disconnected by the event admin. Use forceReconnect to re-enable.",
    });
  }

  const matchingSource = (eventRecord.livePlaylistSources ?? []).find(
    (s) => s.id === sourceId || s.id === "rekordbox",
  );
  const sourceDjName = matchingSource?.djName || matchingSource?.name || sourceId;
  const lastPush = eventRecord.autoMatchState?.[sourceId];

  return json(200, {
    status: "active",
    sourceId,
    sourceName: sourceDjName,
    lastPushedAt: lastPush?.lastMatchedAt || null,
    message: "Connection OK. Source is active and ready to push tracks.",
  });
};
