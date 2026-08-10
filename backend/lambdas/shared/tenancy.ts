import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type {
  EventRecord,
  OrganizationMembershipRecord,
  OrganizationRole,
} from "./types";
import { docClient, env } from "./utils";

export interface CallerIdentity {
  userId: string;
  email: string;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 | 404 = 403,
  ) {
    super(message);
  }
}

type EventWithAuthorizer = APIGatewayProxyEventV2 & {
  requestContext: APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: {
      claims?: Record<string, string>;
      jwt?: { claims?: Record<string, string | number | boolean | string[]> };
    };
  };
};

function authorizerClaims(event: APIGatewayProxyEventV2): Record<string, unknown> {
  const authorizer = (event as EventWithAuthorizer).requestContext?.authorizer;
  return authorizer?.jwt?.claims ?? authorizer?.claims ?? {};
}

export function getCallerIdentity(event: APIGatewayProxyEventV2): CallerIdentity {
  const claims = authorizerClaims(event);
  const userId = String(claims.sub ?? "").trim();
  if (!userId) {
    throw new AuthorizationError("Authentication required", 401);
  }
  return {
    userId,
    email: String(claims.email ?? claims["cognito:username"] ?? "").trim().toLowerCase(),
  };
}

export async function getMembership(
  organizationId: string,
  userId: string,
): Promise<OrganizationMembershipRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: env.membershipsTableName,
      Key: { organizationId, userId },
    }),
  );
  return (result.Item as OrganizationMembershipRecord | undefined) ?? null;
}

export async function requireOrganizationRole(
  event: APIGatewayProxyEventV2,
  organizationId: string,
  allowedRoles: OrganizationRole[] = ["owner", "admin", "dj"],
): Promise<{ caller: CallerIdentity; membership: OrganizationMembershipRecord }> {
  const caller = getCallerIdentity(event);
  const membership = await getMembership(organizationId, caller.userId);
  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new AuthorizationError("You do not have access to this organization");
  }
  return { caller, membership };
}

export async function getEventRecord(eventId: string): Promise<EventRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
    }),
  );
  return (result.Item as EventRecord | undefined) ?? null;
}

export function membershipCanAccessEvent(
  eventRecord: EventRecord,
  membership: OrganizationMembershipRecord | null,
  allowedRoles: OrganizationRole[] = ["owner", "admin", "dj"],
): boolean {
  if (eventRecord.accountMode !== "saas") {
    return membership?.organizationId === (eventRecord.organizationId ?? "mapl-legacy");
  }
  if (!eventRecord.organizationId) return false;
  return Boolean(
    membership
    && membership.organizationId === eventRecord.organizationId
    && allowedRoles.includes(membership.role),
  );
}

/**
 * Legacy users are imported into the internal MAPL membership during the
 * compatibility migration. SaaS users never inherit legacy access merely by
 * creating a Cognito account.
 */
export async function requireEventAccess(
  event: APIGatewayProxyEventV2,
  eventId: string,
  allowedRoles: OrganizationRole[] = ["owner", "admin", "dj"],
): Promise<{
  caller: CallerIdentity;
  eventRecord: EventRecord;
  membership: OrganizationMembershipRecord | null;
}> {
  const caller = getCallerIdentity(event);
  const eventRecord = await getEventRecord(eventId);
  if (!eventRecord) {
    throw new AuthorizationError("Event not found", 404);
  }

  const organizationId = eventRecord.accountMode === "saas"
    ? eventRecord.organizationId
    : (eventRecord.organizationId ?? "mapl-legacy");
  if (!organizationId) {
    throw new AuthorizationError("Event tenant is not configured");
  }
  const membership = await getMembership(organizationId, caller.userId);
  if (!membershipCanAccessEvent(eventRecord, membership, allowedRoles)) {
    throw new AuthorizationError("You do not have access to this event");
  }
  return { caller, eventRecord, membership };
}

export function authorizationResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return {
      statusCode: error.statusCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
  throw error;
}
