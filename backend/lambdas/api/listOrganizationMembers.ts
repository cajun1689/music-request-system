import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    if (!organizationId) return json(400, { error: "organizationId is required" });
    await requireOrganizationRole(event, organizationId);
    const result = await docClient.send(
      new QueryCommand({
        TableName: env.membershipsTableName,
        KeyConditionExpression: "organizationId = :organizationId",
        ExpressionAttributeValues: { ":organizationId": organizationId },
      }),
    );
    return json(200, { members: result.Items ?? [] });
  } catch (error) {
    return authorizationResponse(error);
  }
};
