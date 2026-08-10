import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createHash, timingSafeEqual } from "node:crypto";
import { organizationAllowsUsage } from "./plans";
import type { BridgeDeviceRecord, EventRecord, OrganizationRecord } from "./types";
import { docClient, env } from "./utils";

export interface BridgeAuthorization {
  mode: "legacy" | "device";
  device?: BridgeDeviceRecord;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function deviceCanAccessEvent(
  device: Pick<BridgeDeviceRecord, "organizationId" | "eventId" | "status">,
  eventRecord: Pick<EventRecord, "organizationId" | "eventId">,
): boolean {
  return device.status === "active"
    && device.eventId === eventRecord.eventId
    && device.organizationId === eventRecord.organizationId;
}

export async function authorizeBridgeRequest(
  event: APIGatewayProxyEventV2,
  eventRecord: EventRecord,
): Promise<BridgeAuthorization | null> {
  const legacyToken = event.headers?.["x-push-token"] ?? event.headers?.["X-Push-Token"];
  if (legacyToken && eventRecord.pushToken && safeEqual(legacyToken, eventRecord.pushToken)) {
    return { mode: "legacy" };
  }

  const device = await authorizeBridgeDevice(event);
  if (!device || !deviceCanAccessEvent(device, eventRecord)) {
    return null;
  }
  const organizationResult = await docClient.send(
    new GetCommand({
      TableName: env.organizationsTableName,
      Key: { organizationId: device.organizationId },
    }),
  );
  const organization = organizationResult.Item as OrganizationRecord | undefined;
  if (!organization || !organizationAllowsUsage(organization)) {
    return null;
  }
  return { mode: "device", device };
}

export async function authorizeBridgeDevice(
  event: APIGatewayProxyEventV2,
): Promise<BridgeDeviceRecord | null> {
  const deviceId = event.headers?.["x-device-id"] ?? event.headers?.["X-Device-Id"];
  const authorization = event.headers?.authorization ?? event.headers?.Authorization ?? "";
  const rawToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!deviceId || !rawToken) return null;

  const result = await docClient.send(
    new GetCommand({
      TableName: env.bridgeDevicesTableName,
      Key: { deviceId },
    }),
  );
  const device = result.Item as BridgeDeviceRecord | undefined;
  if (!device || device.status !== "active") return null;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  if (!safeEqual(tokenHash, device.tokenHash)) return null;

  const now = new Date().toISOString();
  device.lastSeenAt = now;
  void docClient.send(
    new UpdateCommand({
      TableName: env.bridgeDevicesTableName,
      Key: { deviceId },
      UpdateExpression: "SET lastSeenAt = :now, updatedAt = :now",
      ExpressionAttributeValues: { ":now": now },
    }),
  ).catch((error) => console.warn("bridgeAuth: lastSeen update failed", String(error)));
  return device;
}
