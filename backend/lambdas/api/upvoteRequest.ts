import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createHash } from "node:crypto";
import { incrementUsage } from "../shared/usage";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const requestId = event.pathParameters?.requestId;
  if (!eventId || !requestId) {
    return json(400, { error: "eventId and requestId are required" });
  }
  const requestContext = event.requestContext as typeof event.requestContext & {
    identity?: { sourceIp?: string };
  };
  const sourceIp = event.requestContext.http?.sourceIp ?? requestContext.identity?.sourceIp ?? "unknown";
  const voterHash = createHash("sha256").update(sourceIp).digest("hex").slice(0, 16);
  const minute = new Date().toISOString().slice(0, 16);
  const upvoteCount = await incrementUsage(
    `upvote#${eventId}#${voterHash}`,
    `minute#${minute}`,
    2 * 60 * 60,
  );
  if (upvoteCount > 20) {
    return json(429, { error: "Too many upvotes. Please try again later." });
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId },
      UpdateExpression: "ADD upvotes :inc",
      ConditionExpression: "attribute_exists(eventId) AND (#s = :pending OR #s = :approved)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":inc": 1,
        ":pending": "pending",
        ":approved": "approved",
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
