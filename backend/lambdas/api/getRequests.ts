import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { authorizeBridgeRequest } from "../shared/bridgeAuth";
import { toPublicRequest } from "../shared/publicRequest";
import type { EventRecord, RequestStatus } from "../shared/types";
import { docClient, env, json } from "../shared/utils";

const VALID_STATUSES: RequestStatus[] = ["pending", "approved", "vetoed", "played"];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const statusParam = event.queryStringParameters?.status as RequestStatus | undefined;
  const status = statusParam && VALID_STATUSES.includes(statusParam) ? statusParam : undefined;
  const eventResult = await docClient.send(
    new GetCommand({ TableName: env.eventsTableName, Key: { eventId } }),
  );
  const eventRecord = eventResult.Item as EventRecord | undefined;
  if (!eventRecord) return json(404, { error: "Event not found" });
  const bridgeAuthorized = Boolean(await authorizeBridgeRequest(event, eventRecord));
  if (status && !bridgeAuthorized && !["pending", "approved"].includes(status)) {
    return json(403, { error: "Historical request data requires authentication" });
  }
  const sanitize = (item: Record<string, unknown>) => {
    if (bridgeAuthorized) return item;
    return toPublicRequest(item);
  };

  if (status) {
    const byStatus = await docClient.send(
      new QueryCommand({
        TableName: env.requestsTableName,
        IndexName: "eventId-status-index",
        KeyConditionExpression: "eventId = :eventId and #status = :status",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":eventId": eventId,
          ":status": status,
        },
      }),
    );

    const items = [...(byStatus.Items ?? [])];
    if (status === "approved") {
      items.sort((a, b) => Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER));
    } else {
      items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    }

    return json(200, items.map(sanitize));
  }

  const all = await docClient.send(
    new QueryCommand({
      TableName: env.requestsTableName,
      KeyConditionExpression: "eventId = :eventId",
      ExpressionAttributeValues: {
        ":eventId": eventId,
      },
    }),
  );

  const sortedItems = [...(all.Items ?? [])]
    .filter((item) => bridgeAuthorized || item.status === "pending" || item.status === "approved")
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
    .map(sanitize);

  return json(200, sortedItems);
};
