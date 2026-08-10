import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { entitlementsForPlan } from "../shared/plans";
import { getCallerIdentity, authorizationResponse } from "../shared/tenancy";
import type {
  OrganizationMembershipRecord,
  OrganizationRecord,
  SaasPlanId,
} from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface CreateOrganizationInput {
  name: string;
  slug: string;
  planId?: SaasPlanId;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const input = parseBody<CreateOrganizationInput>(event.body);
    const name = input?.name?.trim();
    const slug = input?.slug?.trim().toLowerCase();
    const planId: SaasPlanId = input?.planId === "organization" ? "organization" : "dj";
    if (!name || !slug || !/^[a-z0-9][a-z0-9-]{2,47}$/.test(slug)) {
      return json(400, { error: "Name and a valid 3–48 character organization slug are required" });
    }

    const organizationId = randomUUID();
    const now = new Date().toISOString();
    const organization: OrganizationRecord = {
      organizationId,
      slug,
      name,
      accountMode: "saas",
      accountStatus: "active",
      ownerUserId: caller.userId,
      memberCount: 1,
      branding: {
        primaryColor: "#0f172a",
        secondaryColor: "#1e293b",
        accentColor: "#f97316",
      },
      defaults: {},
      subscriptionStatus: "incomplete",
      planId,
      entitlements: entitlementsForPlan(planId),
      createdAt: now,
      updatedAt: now,
    };
    const membership: OrganizationMembershipRecord = {
      organizationId,
      userId: caller.userId,
      email: caller.email,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: env.organizationsTableName,
              Item: organization,
              ConditionExpression: "attribute_not_exists(organizationId)",
            },
          },
          {
            Put: {
              TableName: env.organizationsTableName,
              Item: {
                organizationId: `slug#${slug}`,
                recordType: "slug-reservation",
                targetOrganizationId: organizationId,
                createdAt: now,
              },
              ConditionExpression: "attribute_not_exists(organizationId)",
            },
          },
          {
            Put: {
              TableName: env.membershipsTableName,
              Item: membership,
              ConditionExpression: "attribute_not_exists(organizationId)",
            },
          },
        ],
      }),
    );

    return json(201, { organization, membership });
  } catch (error) {
    if ((error as { name?: string }).name === "TransactionCanceledException") {
      return json(409, { error: "That organization slug is already in use" });
    }
    return authorizationResponse(error);
  }
};
