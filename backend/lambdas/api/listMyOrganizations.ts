import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getCallerIdentity, authorizationResponse } from "../shared/tenancy";
import type {
  OrganizationMembershipRecord,
  OrganizationRecord,
} from "../shared/types";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const caller = getCallerIdentity(event);
    const membershipResult = await docClient.send(
      new QueryCommand({
        TableName: env.membershipsTableName,
        IndexName: "userId-index",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": caller.userId },
      }),
    );
    const memberships = (membershipResult.Items ?? []) as OrganizationMembershipRecord[];
    if (memberships.length === 0) {
      return json(200, { organizations: [], memberships: [] });
    }

    const organizationsResult = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [env.organizationsTableName]: {
            Keys: memberships.map(({ organizationId }) => ({ organizationId })),
          },
        },
      }),
    );
    const organizations =
      (organizationsResult.Responses?.[env.organizationsTableName] as OrganizationRecord[] | undefined) ?? [];
    const byId = new Map(organizations.map((organization) => [organization.organizationId, organization]));
    const orderedOrganizations = memberships
      .map(({ organizationId }) => byId.get(organizationId))
      .filter((organization): organization is OrganizationRecord => Boolean(organization));

    return json(200, { organizations: orderedOrganizations, memberships });
  } catch (error) {
    return authorizationResponse(error);
  }
};
