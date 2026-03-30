import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { RequestStatus } from "../shared/types";
import { docClient, env, json } from "../shared/utils";

const VALID_STATUSES: RequestStatus[] = ["pending", "approved", "vetoed", "played"];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const statusParam = event.queryStringParameters?.status as RequestStatus | undefined;
  const status = statusParam && VALID_STATUSES.includes(statusParam) ? statusParam : undefined;

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

    return json(200, items);
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

  const sortedItems = [...(all.Items ?? [])].sort((a, b) =>
    String(b.submittedAt).localeCompare(String(a.submittedAt)),
  );

  return json(200, sortedItems);
};
