import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireEventAccess, authorizationResponse } from "../shared/tenancy";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const eventId = event.pathParameters?.eventId;
    if (!eventId) return json(400, { error: "eventId is required" });
    await requireEventAccess(event, eventId);
    const result = await docClient.send(
      new QueryCommand({
        TableName: env.requestsTableName,
        KeyConditionExpression: "eventId = :eventId",
        ExpressionAttributeValues: { ":eventId": eventId },
      }),
    );
    const requests = [...(result.Items ?? [])].sort((a, b) =>
      String(b.submittedAt).localeCompare(String(a.submittedAt)),
    );
    return json(200, requests);
  } catch (error) {
    return authorizationResponse(error);
  }
};
