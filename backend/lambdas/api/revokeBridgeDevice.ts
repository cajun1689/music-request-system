import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    const deviceId = event.pathParameters?.deviceId;
    if (!organizationId || !deviceId) {
      return json(400, { error: "organizationId and deviceId are required" });
    }
    await requireOrganizationRole(event, organizationId, ["owner", "admin"]);
    const deviceResult = await docClient.send(
      new GetCommand({
        TableName: env.bridgeDevicesTableName,
        Key: { deviceId },
      }),
    );
    if (!deviceResult.Item || deviceResult.Item.organizationId !== organizationId) {
      return json(404, { error: "Device not found" });
    }
    await docClient.send(
      new UpdateCommand({
        TableName: env.bridgeDevicesTableName,
        Key: { deviceId },
        UpdateExpression: "SET #status = :revoked, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":revoked": "revoked",
          ":now": new Date().toISOString(),
        },
      }),
    );
    return json(200, { deviceId, revoked: true });
  } catch (error) {
    return authorizationResponse(error);
  }
};
