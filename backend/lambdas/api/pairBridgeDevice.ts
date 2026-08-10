import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { organizationAllowsUsage } from "../shared/plans";
import type { EventRecord, OrganizationRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface PairDeviceInput {
  code: string;
  deviceName?: string;
  platform?: string;
}

interface PairingRecord {
  deviceId: string;
  organizationId: string;
  eventId: string;
  sourceId: string;
  deviceName: string;
  createdBy: string;
  expiresAt: number;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const input = parseBody<PairDeviceInput>(event.body);
  if (!input) return json(400, { error: "A valid JSON request body is required" });
  const code = input?.code?.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (!code) return json(400, { error: "Pairing code is required" });
  const codeHash = createHash("sha256").update(code).digest("hex");
  const pairingKey = `pairing#${codeHash}`;
  const pairingResult = await docClient.send(
    new GetCommand({
      TableName: env.bridgeDevicesTableName,
      Key: { deviceId: pairingKey },
    }),
  );
  const pairing = pairingResult.Item as PairingRecord | undefined;
  if (!pairing || pairing.expiresAt <= Math.floor(Date.now() / 1000)) {
    return json(410, { error: "Pairing code is invalid or expired" });
  }

  const [eventResult, organizationResult] = await Promise.all([
    docClient.send(new GetCommand({ TableName: env.eventsTableName, Key: { eventId: pairing.eventId } })),
    docClient.send(
      new GetCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId: pairing.organizationId },
      }),
    ),
  ]);
  const eventRecord = eventResult.Item as EventRecord | undefined;
  const organization = organizationResult.Item as OrganizationRecord | undefined;
  if (
    !eventRecord
    || !organization
    || eventRecord.accountMode !== "saas"
    || eventRecord.organizationId !== pairing.organizationId
  ) {
    return json(409, { error: "Pairing target is no longer available" });
  }
  if (!organizationAllowsUsage(organization)) {
    return json(402, { error: "The organization subscription is not active" });
  }

  const deviceId = randomUUID();
  const deviceToken = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: env.bridgeDevicesTableName,
            Key: { deviceId: pairingKey },
            ConditionExpression: "attribute_exists(deviceId)",
          },
        },
        {
          Put: {
            TableName: env.bridgeDevicesTableName,
            Item: {
              deviceId,
              organizationId: pairing.organizationId,
              eventId: pairing.eventId,
              sourceId: pairing.sourceId,
              name: input.deviceName?.trim() || pairing.deviceName,
              platform: input.platform?.trim() || "macOS",
              tokenHash: createHash("sha256").update(deviceToken).digest("hex"),
              status: "active",
              createdBy: pairing.createdBy,
              createdAt: now,
              updatedAt: now,
              lastSeenAt: now,
            },
            ConditionExpression: "attribute_not_exists(deviceId)",
          },
        },
      ],
    }),
  );
  return json(201, {
    deviceId,
    deviceToken,
    organizationId: organization.organizationId,
    organizationName: organization.name,
    eventId: eventRecord.eventId,
    eventName: eventRecord.name,
    sourceId: pairing.sourceId,
  });
};
