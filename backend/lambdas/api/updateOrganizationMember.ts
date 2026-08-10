import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import type { OrganizationMembershipRecord, OrganizationRole } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface UpdateMemberInput {
  role?: Exclude<OrganizationRole, "owner">;
  transferOwnership?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    const userId = event.pathParameters?.userId;
    if (!organizationId || !userId) {
      return json(400, { error: "organizationId and userId are required" });
    }
    const method =
      (event as typeof event & { httpMethod?: string }).httpMethod
      ?? event.requestContext.http?.method;
    const { caller } = await requireOrganizationRole(event, organizationId, ["owner"]);
    const input = method === "DELETE"
      ? {}
      : parseBody<UpdateMemberInput>(event.body);
    if (!input) return json(400, { error: "A valid JSON request body is required" });
    if (caller.userId === userId && !input.transferOwnership) {
      return json(409, { error: "Transfer ownership before changing your own role" });
    }
    const targetResult = await docClient.send(
      new GetCommand({
        TableName: env.membershipsTableName,
        Key: { organizationId, userId },
      }),
    );
    const target = targetResult.Item as OrganizationMembershipRecord | undefined;
    if (!target) return json(404, { error: "Member not found" });

    const now = new Date().toISOString();
    if (method === "DELETE") {
      if (target.role === "owner" || caller.userId === userId) {
        return json(409, { error: "Transfer ownership before removing the owner" });
      }
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: env.membershipsTableName,
                Key: { organizationId, userId },
                ConditionExpression: "#role <> :owner",
                ExpressionAttributeNames: { "#role": "role" },
                ExpressionAttributeValues: { ":owner": "owner" },
              },
            },
            {
              Update: {
                TableName: env.organizationsTableName,
                Key: { organizationId },
                UpdateExpression: "SET updatedAt = :now ADD memberCount :minusOne",
                ExpressionAttributeValues: { ":now": now, ":minusOne": -1 },
              },
            },
          ],
        }),
      );
      return json(200, { removed: true, userId });
    }

    if (input.transferOwnership) {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: env.membershipsTableName,
                Key: { organizationId, userId: caller.userId },
                ConditionExpression: "#role = :owner",
                UpdateExpression: "SET #role = :admin, updatedAt = :now",
                ExpressionAttributeNames: { "#role": "role" },
                ExpressionAttributeValues: {
                  ":owner": "owner",
                  ":admin": "admin",
                  ":now": now,
                },
              },
            },
            {
              Update: {
                TableName: env.membershipsTableName,
                Key: { organizationId, userId },
                UpdateExpression: "SET #role = :owner, updatedAt = :now",
                ExpressionAttributeNames: { "#role": "role" },
                ExpressionAttributeValues: { ":owner": "owner", ":now": now },
              },
            },
            {
              Update: {
                TableName: env.organizationsTableName,
                Key: { organizationId },
                UpdateExpression: "SET ownerUserId = :userId, updatedAt = :now",
                ExpressionAttributeValues: { ":userId": userId, ":now": now },
              },
            },
          ],
        }),
      );
      return json(200, { transferred: true, ownerUserId: userId });
    }

    if (!input.role || !["admin", "dj"].includes(input.role)) {
      return json(400, { error: "role must be admin or dj" });
    }
    const result = await docClient.send(
      new UpdateCommand({
        TableName: env.membershipsTableName,
        Key: { organizationId, userId },
        UpdateExpression: "SET #role = :role, updatedAt = :now",
        ExpressionAttributeNames: { "#role": "role" },
        ExpressionAttributeValues: { ":role": input.role, ":now": now },
        ReturnValues: "ALL_NEW",
      }),
    );
    return json(200, { membership: result.Attributes });
  } catch (error) {
    return authorizationResponse(error);
  }
};
