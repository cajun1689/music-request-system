import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { authorizeBridgeDevice } from "../shared/bridgeAuth";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const device = await authorizeBridgeDevice(event);
  if (!device) return json(401, { error: "Invalid or revoked Bridge device credential" });

  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: env.bridgeDevicesTableName,
      Key: { deviceId: device.deviceId },
      ConditionExpression: "#status = :active",
      UpdateExpression: "SET #status = :revoked, revokedAt = :now, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":active": "active",
        ":revoked": "revoked",
        ":now": now,
      },
    }),
  );
  return json(200, { deviceId: device.deviceId, revoked: true });
};
