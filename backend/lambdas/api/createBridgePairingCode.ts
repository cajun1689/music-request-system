import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createHash, randomBytes } from "node:crypto";
import { requireEventAccess, authorizationResponse } from "../shared/tenancy";
import { organizationAllowsUsage } from "../shared/plans";
import type { OrganizationRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface PairingCodeInput {
  eventId: string;
  sourceId: string;
  deviceName?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const input = parseBody<PairingCodeInput>(event.body);
    if (!input) return json(400, { error: "A valid JSON request body is required" });
    const eventId = input?.eventId?.trim();
    const sourceId = input?.sourceId?.trim();
    if (!eventId || !sourceId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(sourceId)) {
      return json(400, { error: "A valid eventId and sourceId are required" });
    }
    const access = await requireEventAccess(event, eventId, ["owner", "admin"]);
    if (access.eventRecord.accountMode !== "saas" || !access.eventRecord.organizationId) {
      return json(409, { error: "Legacy events continue to use their existing push token" });
    }
    const organizationId = access.eventRecord.organizationId;
    const [organizationResult, devicesResult] = await Promise.all([
      docClient.send(
        new GetCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId },
        }),
      ),
      docClient.send(
        new QueryCommand({
          TableName: env.bridgeDevicesTableName,
          IndexName: "organizationId-index",
          KeyConditionExpression: "organizationId = :organizationId",
          ExpressionAttributeValues: {
            ":organizationId": organizationId,
          },
        }),
      ),
    ]);
    const organization = organizationResult.Item as OrganizationRecord | undefined;
    if (!organization) return json(404, { error: "Organization not found" });
    if (!organizationAllowsUsage(organization)) {
      return json(402, { error: "An active organization subscription is required to pair a Bridge" });
    }
    const nowEpoch = Math.floor(Date.now() / 1000);
    const reservedDevices = (devicesResult.Items ?? []).filter(
      (device) =>
        device.status === "active"
        || (device.recordType === "pairing" && Number(device.expiresAt ?? 0) > nowEpoch),
    );
    if (reservedDevices.length >= organization.entitlements.maxBridgeDevices) {
      return json(409, { error: "This organization has reached its Bridge device limit" });
    }
    if (
      reservedDevices.some(
        (device) => device.eventId === eventId && device.sourceId === sourceId,
      )
    ) {
      return json(409, {
        error: "That source ID is already paired to this event. Disconnect it or choose another source ID.",
      });
    }

    const code = randomBytes(5).toString("hex").toUpperCase();
    const codeHash = createHash("sha256").update(code).digest("hex");
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    await docClient.send(
      new PutCommand({
        TableName: env.bridgeDevicesTableName,
        Item: {
          deviceId: `pairing#${codeHash}`,
          recordType: "pairing",
          organizationId,
          eventId,
          sourceId,
          deviceName: input.deviceName?.trim() || "DJ Bridge",
          createdBy: access.caller.userId,
          expiresAt,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(deviceId)",
      }),
    );
    return json(201, { code, expiresAt });
  } catch (error) {
    return authorizationResponse(error);
  }
};
