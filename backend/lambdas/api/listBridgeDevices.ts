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
        TableName: env.bridgeDevicesTableName,
        IndexName: "organizationId-index",
        KeyConditionExpression: "organizationId = :organizationId",
        FilterExpression: "attribute_not_exists(recordType)",
        ExpressionAttributeValues: { ":organizationId": organizationId },
      }),
    );
    const devices = (result.Items ?? []).map(({ tokenHash: _tokenHash, ...device }) => device);
    return json(200, { devices });
  } catch (error) {
    return authorizationResponse(error);
  }
};
