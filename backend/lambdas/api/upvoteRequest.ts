import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const requestId = event.pathParameters?.requestId;
  if (!eventId || !requestId) {
    return json(400, { error: "eventId and requestId are required" });
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
