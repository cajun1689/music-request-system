import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { AuthorizationError } from "./tenancy";
import type {
  PlatformAuditRecord,
  PlatformSupportMode,
  PlatformSupportSessionRecord,
} from "./types";
import { docClient, env } from "./utils";

export interface PlatformActor {
  userId: string;
  email: string;
  sourceIp?: string;
}

function tableName(): string {
  if (!env.platformOperationsTableName) {
    throw new Error("PLATFORM_OPERATIONS_TABLE_NAME is required");
  }
  return env.platformOperationsTableName;
}

export async function writePlatformAudit(input: {
  actor: PlatformActor;
  action: string;
  organizationId?: string;
  targetUserId?: string;
  supportSessionId?: string;
  reason?: string;
  outcome?: "pending" | "success" | "failure";
  details?: Record<string, unknown>;
}, options?: { strict?: boolean }): Promise<PlatformAuditRecord> {
  const record: PlatformAuditRecord = {
    recordId: `audit#${randomUUID()}`,
    recordType: "audit",
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    action: input.action,
    organizationId: input.organizationId,
    targetUserId: input.targetUserId,
    supportSessionId: input.supportSessionId,
    reason: input.reason,
    outcome: input.outcome ?? "success",
    sourceIp: input.actor.sourceIp,
    details: input.details,
    createdAt: new Date().toISOString(),
  };
  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName(),
        Item: record,
        ConditionExpression: "attribute_not_exists(recordId)",
      }),
    );
  } catch (error) {
    if (options?.strict) throw error;
    console.error("platformOperations: audit write failed", {
      action: record.action,
      organizationId: record.organizationId,
      recordId: record.recordId,
      error: String(error),
    });
  }
  return record;
}

export async function createSupportSession(input: {
  actor: PlatformActor;
  organizationId: string;
  targetUserId?: string;
  mode: PlatformSupportMode;
  reason: string;
  durationMinutes: number;
}): Promise<PlatformSupportSessionRecord> {
  if (!input.organizationId.trim()) throw new Error("organizationId is required");
  if (!["read_only", "support_write"].includes(input.mode)) {
    throw new Error("mode must be read_only or support_write");
  }
  if (!input.reason.trim()) throw new Error("reason is required");
  if (
    !Number.isInteger(input.durationMinutes)
    || input.durationMinutes < 1
    || input.durationMinutes > 60
  ) {
    throw new Error("durationMinutes must be an integer from 1 through 60");
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.durationMinutes * 60_000);
  const record: PlatformSupportSessionRecord = {
    recordId: `support#${randomUUID()}`,
    recordType: "support_session",
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    organizationId: input.organizationId,
    targetUserId: input.targetUserId,
    mode: input.mode,
    reason: input.reason.trim(),
    createdAt: now.toISOString(),
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
    expiresAtIso: expiresAt.toISOString(),
    retentionExpiresAt: Math.floor(now.getTime() / 1000) + 400 * 24 * 60 * 60,
  };
  const audit: PlatformAuditRecord = {
    recordId: `audit#${randomUUID()}`,
    recordType: "audit",
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    action: "support_session.start",
    organizationId: input.organizationId,
    targetUserId: input.targetUserId,
    supportSessionId: record.recordId,
    reason: record.reason,
    outcome: "success",
    sourceIp: input.actor.sourceIp,
    details: { mode: record.mode, expiresAt: record.expiresAtIso },
    createdAt: record.createdAt,
  };
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: record,
            ConditionExpression: "attribute_not_exists(recordId)",
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: audit,
            ConditionExpression: "attribute_not_exists(recordId)",
          },
        },
      ],
    }),
  );
  return record;
}

export async function getSupportSession(
  sessionId: string,
): Promise<PlatformSupportSessionRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName(),
      Key: { recordId: sessionId },
    }),
  );
  if (!result.Item || result.Item.recordType !== "support_session") return null;
  return result.Item as PlatformSupportSessionRecord;
}

export function supportSessionAccessError(
  session: PlatformSupportSessionRecord,
  input: {
    actorUserId: string;
    organizationId?: string;
    requireWrite?: boolean;
    now?: number;
  },
): string | undefined {
  if (session.actorUserId !== input.actorUserId) {
    return "Support session belongs to another administrator";
  }
  if (input.organizationId && session.organizationId !== input.organizationId) {
    return "Support session is not valid for this organization";
  }
  if (session.revokedAt) return "Support session has ended";
  if (session.expiresAt * 1000 <= (input.now ?? Date.now())) {
    return "Support session has expired";
  }
  if (input.requireWrite && session.mode !== "support_write") {
    return "This support session is read-only";
  }
  return undefined;
}

export async function validateSupportSession(input: {
  sessionId: string;
  actorUserId: string;
  organizationId?: string;
  requireWrite?: boolean;
}): Promise<PlatformSupportSessionRecord> {
  const session = await getSupportSession(input.sessionId);
  if (!session) throw new AuthorizationError("Support session not found", 404);
  const accessError = supportSessionAccessError(session, input);
  if (accessError) throw new AuthorizationError(accessError);
  return session;
}

export async function revokeSupportSession(input: {
  sessionId: string;
  actorUserId: string;
  allowAnyPlatformActor?: boolean;
}): Promise<PlatformSupportSessionRecord> {
  const session = await getSupportSession(input.sessionId);
  if (!session) throw new AuthorizationError("Support session not found", 404);
  if (!input.allowAnyPlatformActor && session.actorUserId !== input.actorUserId) {
    throw new AuthorizationError("Support session belongs to another administrator");
  }
  if (session.revokedAt) throw new AuthorizationError("Support session has ended");
  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { recordId: input.sessionId },
      ConditionExpression: input.allowAnyPlatformActor
        ? "recordType = :session AND attribute_not_exists(revokedAt)"
        : "recordType = :session AND actorUserId = :sessionActor AND attribute_not_exists(revokedAt)",
      UpdateExpression: "SET revokedAt = :now, revokedBy = :actor",
      ExpressionAttributeValues: {
        ":session": "support_session",
        ":actor": input.actorUserId,
        ...(input.allowAnyPlatformActor ? {} : { ":sessionActor": input.actorUserId }),
        ":now": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return result.Attributes as PlatformSupportSessionRecord;
}
