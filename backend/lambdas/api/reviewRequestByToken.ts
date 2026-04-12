import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord, RequestStatus } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

const ALLOWED_STATUSES: RequestStatus[] = ["approved", "vetoed", "played"];

interface ReviewInput {
  requestId: string;
  status: RequestStatus;
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
  if (!input.status || !ALLOWED_STATUSES.includes(input.status)) {
    return json(400, { error: "status must be 'approved', 'vetoed', or 'played'" });
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

  const updateExpr = input.status === "played"
    ? "SET #status = :status, reviewedAt = :reviewedAt, reviewedBy = :reviewedBy, playedAt = :playedAt"
    : "SET #status = :status, reviewedAt = :reviewedAt, reviewedBy = :reviewedBy";

  const exprValues: Record<string, string> = {
    ":status": input.status,
    ":reviewedAt": now,
    ":reviewedBy": "dj-bridge",
  };
  if (input.status === "played") exprValues[":playedAt"] = now;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId: input.requestId },
      ConditionExpression:
        "attribute_exists(eventId) and attribute_exists(requestId)",
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: exprValues,
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
