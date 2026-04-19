import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord, RequestStatus } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

const ALLOWED_STATUSES: RequestStatus[] = ["approved", "vetoed", "played"];

interface ReviewInput {
  requestId: string;
  status?: RequestStatus;
  shoutoutApproved?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) return json(400, { error: "eventId is required" });

  const pushToken =
    event.headers?.["x-push-token"] ?? event.headers?.["X-Push-Token"] ?? "";
  if (!pushToken) return json(401, { error: "Missing x-push-token header" });

  const input = parseBody<ReviewInput>(event.body);
  if (!input?.requestId?.trim()) {
    return json(400, { error: "requestId is required" });
  }

  const hasStatus = input.status && ALLOWED_STATUSES.includes(input.status);
  const hasShoutout = typeof input.shoutoutApproved === "boolean";

  if (!hasStatus && !hasShoutout) {
    return json(400, { error: "status or shoutoutApproved is required" });
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
  const exprParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  if (hasStatus) {
    exprNames["#status"] = "status";
    exprParts.push("#status = :status", "reviewedAt = :reviewedAt", "reviewedBy = :reviewedBy");
    exprValues[":status"] = input.status;
    exprValues[":reviewedAt"] = now;
    exprValues[":reviewedBy"] = "dj-bridge";
    if (input.status === "played") {
      exprParts.push("playedAt = :playedAt");
      exprValues[":playedAt"] = now;
    }
  }

  if (hasShoutout) {
    exprParts.push("shoutoutApproved = :shoutoutApproved");
    exprValues[":shoutoutApproved"] = input.shoutoutApproved;
    if (input.shoutoutApproved) {
      exprParts.push("shoutoutApprovedAt = :shoutoutApprovedAt");
      exprValues[":shoutoutApprovedAt"] = now;
    }
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId: input.requestId },
      ConditionExpression:
        "attribute_exists(eventId) and attribute_exists(requestId)",
      UpdateExpression: `SET ${exprParts.join(", ")}`,
      ExpressionAttributeNames: Object.keys(exprNames).length ? exprNames : undefined,
      ExpressionAttributeValues: exprValues,
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
