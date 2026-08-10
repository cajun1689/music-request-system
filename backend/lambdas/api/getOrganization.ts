import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    if (!organizationId) return json(400, { error: "organizationId is required" });
    const { membership } = await requireOrganizationRole(event, organizationId);
    const result = await docClient.send(
      new GetCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
      }),
    );
    if (!result.Item) return json(404, { error: "Organization not found" });
    if (event.queryStringParameters?.analytics === "true") {
      const days = Math.min(3650, Math.max(1, Number(event.queryStringParameters.days ?? 30)));
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const requestsResult = await docClient.send(
        new QueryCommand({
          TableName: env.requestsTableName,
          IndexName: "organizationId-submittedAt-index",
          KeyConditionExpression: "organizationId = :organizationId AND submittedAt >= :from",
          ExpressionAttributeValues: {
            ":organizationId": organizationId,
            ":from": from,
          },
          Limit: 5000,
        }),
      );
      const requests = requestsResult.Items ?? [];
      return json(200, {
        organizationId,
        from,
        through: new Date().toISOString(),
        truncated: Boolean(requestsResult.LastEvaluatedKey),
        metrics: {
          requests: requests.length,
          pending: requests.filter((request) => request.status === "pending").length,
          approved: requests.filter((request) => request.status === "approved").length,
          played: requests.filter((request) => request.status === "played").length,
          vetoed: requests.filter((request) => request.status === "vetoed").length,
          verifiedTips: requests.filter((request) => request.paymentStatus === "verified").length,
          tipTotal: Number(
            requests
              .filter((request) => request.paymentStatus === "verified")
              .reduce((sum, request) => sum + Number(request.tipAmount ?? 0), 0)
              .toFixed(2),
          ),
        },
      });
    }
    if (event.queryStringParameters?.export === "true") {
      if (membership.role !== "owner") {
        return json(403, { error: "Only the organization owner can export organization data" });
      }
      const eventsResult = await docClient.send(
        new QueryCommand({
          TableName: env.eventsTableName,
          IndexName: "organizationId-createdAt-index",
          KeyConditionExpression: "organizationId = :organizationId",
          ExpressionAttributeValues: { ":organizationId": organizationId },
          Limit: 25,
        }),
      );
      const requests = [];
      let truncated = Boolean(eventsResult.LastEvaluatedKey);
      for (const eventRecord of eventsResult.Items ?? []) {
        const requestsResult = await docClient.send(
          new QueryCommand({
            TableName: env.requestsTableName,
            KeyConditionExpression: "eventId = :eventId",
            ExpressionAttributeValues: { ":eventId": eventRecord.eventId },
            Limit: 1000,
          }),
        );
        requests.push(...(requestsResult.Items ?? []));
        truncated ||= Boolean(requestsResult.LastEvaluatedKey);
      }
      return json(200, {
        exportedAt: new Date().toISOString(),
        truncated,
        organization: result.Item,
        events: eventsResult.Items ?? [],
        requests,
      });
    }
    return json(200, { organization: result.Item, membership });
  } catch (error) {
    return authorizationResponse(error);
  }
};
