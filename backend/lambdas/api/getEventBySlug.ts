import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";
import { requireEventAccess, authorizationResponse } from "../shared/tenancy";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const slug = event.pathParameters?.slug;
  if (!slug) {
    return json(400, { error: "slug is required" });
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: env.eventsTableName,
      IndexName: "slug-index",
      KeyConditionExpression: "slug = :slug",
      ExpressionAttributeValues: {
        ":slug": slug,
      },
      Limit: 1,
    }),
  );

  const item = result.Items?.[0];
  if (!item) {
    return json(404, { error: "Event not found" });
  }
  try {
    await requireEventAccess(event, String(item.eventId));
  } catch (error) {
    return authorizationResponse(error);
  }

  return json(200, item);
};
