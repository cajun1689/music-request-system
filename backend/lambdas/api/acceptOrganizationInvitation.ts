import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createHash } from "node:crypto";
import { getCallerIdentity, authorizationResponse } from "../shared/tenancy";
import { organizationAllowsUsage } from "../shared/plans";
import type {
  OrganizationInvitationRecord,
  OrganizationMembershipRecord,
  OrganizationRecord,
} from "../shared/types";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const token = event.pathParameters?.token;
    if (!token) return json(400, { error: "Invitation token is required" });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await docClient.send(
      new QueryCommand({
        TableName: env.invitationsTableName,
        IndexName: "tokenHash-index",
        KeyConditionExpression: "tokenHash = :tokenHash",
        ExpressionAttributeValues: { ":tokenHash": tokenHash },
        Limit: 1,
      }),
    );
    const invitation = result.Items?.[0] as OrganizationInvitationRecord | undefined;
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= Math.floor(Date.now() / 1000)) {
      return json(410, { error: "This invitation is invalid or has expired" });
    }
    if (!caller.email || invitation.email !== caller.email) {
      return json(403, { error: "This invitation was sent to a different email address" });
    }
    const organizationResult = await docClient.send(
      new GetCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId: invitation.organizationId },
      }),
    );
    const organization = organizationResult.Item as OrganizationRecord | undefined;
    if (!organization || !organizationAllowsUsage(organization)) {
      return json(409, { error: "This organization is not currently accepting invitations" });
    }

    const now = new Date().toISOString();
    const membership: OrganizationMembershipRecord = {
      organizationId: invitation.organizationId,
      userId: caller.userId,
      email: caller.email || invitation.email,
      role: invitation.role,
      createdAt: now,
      updatedAt: now,
    };
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: env.organizationsTableName,
              Key: { organizationId: invitation.organizationId },
              ConditionExpression:
                "accountStatus = :active AND "
                + "(subscriptionStatus = :subscribed OR subscriptionStatus = :trialing) AND "
                + "memberCount < :maxMembers",
              UpdateExpression: "SET updatedAt = :now ADD memberCount :one",
              ExpressionAttributeValues: {
                ":active": "active",
                ":subscribed": "active",
                ":trialing": "trialing",
                ":maxMembers": organization.entitlements.maxMembers,
                ":one": 1,
                ":now": now,
              },
            },
          },
          {
            Put: {
              TableName: env.membershipsTableName,
              Item: membership,
              ConditionExpression: "attribute_not_exists(userId)",
            },
          },
          {
            Update: {
              TableName: env.invitationsTableName,
              Key: { invitationId: invitation.invitationId },
              ConditionExpression: "attribute_not_exists(acceptedAt)",
              UpdateExpression: "SET acceptedAt = :now",
              ExpressionAttributeValues: { ":now": now },
            },
          },
        ],
      }),
    );
    return json(200, { membership });
  } catch (error) {
    if ((error as { name?: string }).name === "TransactionCanceledException") {
      return json(409, { error: "Invitation already accepted or membership already exists" });
    }
    return authorizationResponse(error);
  }
};
