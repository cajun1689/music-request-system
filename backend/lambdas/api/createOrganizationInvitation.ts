import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import { organizationAllowsUsage } from "../shared/plans";
import type {
  OrganizationInvitationRecord,
  OrganizationRecord,
  OrganizationRole,
} from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface InvitationInput {
  email: string;
  role: Exclude<OrganizationRole, "owner">;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    if (!organizationId) return json(400, { error: "organizationId is required" });
    const { caller } = await requireOrganizationRole(event, organizationId, ["owner", "admin"]);
    const input = parseBody<InvitationInput>(event.body);
    const email = input?.email?.trim().toLowerCase();
    const role = input?.role;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["admin", "dj"].includes(role ?? "")) {
      return json(400, { error: "A valid email and admin or dj role are required" });
    }

    const [organizationResult, memberResult] = await Promise.all([
      docClient.send(
        new GetCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId },
        }),
      ),
      docClient.send(
        new QueryCommand({
          TableName: env.membershipsTableName,
          KeyConditionExpression: "organizationId = :organizationId",
          ExpressionAttributeValues: { ":organizationId": organizationId },
          Select: "COUNT",
        }),
      ),
    ]);
    const organization = organizationResult.Item as OrganizationRecord | undefined;
    if (!organization) return json(404, { error: "Organization not found" });
    if (organization.accountMode === "saas" && !organizationAllowsUsage(organization)) {
      return json(402, { error: "An active organization subscription is required to invite members" });
    }
    if ((memberResult.Count ?? 0) >= organization.entitlements.maxMembers) {
      return json(409, { error: "This organization has reached its member limit" });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const now = new Date();
    const invitation: OrganizationInvitationRecord = {
      invitationId: randomUUID(),
      organizationId,
      email,
      role: role as Exclude<OrganizationRole, "owner">,
      tokenHash,
      invitedBy: caller.userId,
      expiresAt: Math.floor(now.getTime() / 1000) + 7 * 24 * 60 * 60,
      createdAt: now.toISOString(),
    };
    await docClient.send(
      new PutCommand({
        TableName: env.invitationsTableName,
        Item: invitation,
        ConditionExpression: "attribute_not_exists(invitationId)",
      }),
    );
    return json(201, {
      invitation: {
        invitationId: invitation.invitationId,
        organizationId,
        email,
        role,
        expiresAt: invitation.expiresAt,
        inviteUrl: `${env.appBaseUrl}/invitations/${token}`,
      },
    });
  } catch (error) {
    return authorizationResponse(error);
  }
};
