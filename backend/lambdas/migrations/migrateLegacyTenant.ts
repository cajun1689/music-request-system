import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Handler } from "aws-lambda";
import { LEGACY_ENTITLEMENTS } from "../shared/plans";
import type { OrganizationRecord } from "../shared/types";
import { docClient, env } from "../shared/utils";

const LEGACY_ORGANIZATION_ID = "mapl-legacy";
const cognito = new CognitoIdentityProviderClient({});

async function tagTable(
  tableName: string,
  keyNames: string[],
): Promise<number> {
  let lastKey: Record<string, unknown> | undefined;
  let updated = 0;
  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: keyNames.join(", "),
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const key = Object.fromEntries(keyNames.map((name) => [name, item[name]]));
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression:
            "SET organizationId = if_not_exists(organizationId, :organizationId), "
            + "accountMode = if_not_exists(accountMode, :accountMode)",
          ExpressionAttributeValues: {
            ":organizationId": LEGACY_ORGANIZATION_ID,
            ":accountMode": "legacy",
          },
        }),
      );
      updated++;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return updated;
}

export const handler: Handler = async () => {
  const now = new Date().toISOString();
  const organization: OrganizationRecord = {
    organizationId: LEGACY_ORGANIZATION_ID,
    slug: "mapl",
    name: "MAPL",
    accountMode: "legacy",
    accountStatus: "active",
    ownerUserId: "legacy-cognito-users",
    branding: {
      primaryColor: "#0f172a",
      secondaryColor: "#1e293b",
      accentColor: "#f97316",
    },
    defaults: { djBrandName: "MAPL" },
    subscriptionStatus: "active",
    planId: "legacy",
    entitlements: LEGACY_ENTITLEMENTS,
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(
    new PutCommand({
      TableName: env.organizationsTableName,
      Item: organization,
      ConditionExpression: "attribute_not_exists(organizationId)",
    }),
  ).catch((error: { name?: string }) => {
    if (error.name !== "ConditionalCheckFailedException") throw error;
  });

  let legacyUsersAdded = 0;
  const organizationState = await docClient.send(
    new GetCommand({
      TableName: env.organizationsTableName,
      Key: { organizationId: LEGACY_ORGANIZATION_ID },
      ProjectionExpression: "legacyMembershipMigrationCompletedAt",
    }),
  );
  if (!organizationState.Item?.legacyMembershipMigrationCompletedAt) {
    if (!process.env.USER_POOL_ID) {
      throw new Error("USER_POOL_ID is required for the legacy compatibility migration");
    }
    let paginationToken: string | undefined;
    do {
      const usersPage = await cognito.send(
        new ListUsersCommand({
          UserPoolId: process.env.USER_POOL_ID,
          PaginationToken: paginationToken,
        }),
      );
      for (const user of usersPage.Users ?? []) {
        const userId = user.Attributes?.find((attribute) => attribute.Name === "sub")?.Value;
        const email = user.Attributes?.find((attribute) => attribute.Name === "email")?.Value;
        if (!userId) continue;
        await docClient.send(
          new PutCommand({
            TableName: env.membershipsTableName,
            Item: {
              organizationId: LEGACY_ORGANIZATION_ID,
              userId,
              email: email?.toLowerCase() ?? "",
              role: "admin",
              createdAt: now,
              updatedAt: now,
            },
            ConditionExpression: "attribute_not_exists(userId)",
          }),
        ).then(() => {
          legacyUsersAdded++;
        }).catch((error: { name?: string }) => {
          if (error.name !== "ConditionalCheckFailedException") throw error;
        });
      }
      paginationToken = usersPage.PaginationToken;
    } while (paginationToken);
    await docClient.send(
      new UpdateCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId: LEGACY_ORGANIZATION_ID },
        UpdateExpression: "SET legacyMembershipMigrationCompletedAt = :now",
        ExpressionAttributeValues: { ":now": now },
      }),
    );
  }

  const [eventsUpdated, requestsUpdated] = await Promise.all([
    tagTable(env.eventsTableName, ["eventId"]),
    tagTable(env.requestsTableName, ["eventId", "requestId"]),
  ]);
  return {
    organizationId: LEGACY_ORGANIZATION_ID,
    legacyUsersAdded,
    eventsUpdated,
    requestsUpdated,
  };
};
