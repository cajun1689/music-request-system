import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";
import { requireEventAccess, authorizationResponse } from "../shared/tenancy";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }
  try {
    await requireEventAccess(event, eventId, ["owner", "admin"]);
  } catch (error) {
    return authorizationResponse(error);
  }

  const now = new Date().toISOString();
  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      ConditionExpression: "attribute_exists(eventId)",
      UpdateExpression: "SET genreVotes = :genreVotes, genreVotesTotal = :genreVotesTotal, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":genreVotes": { hip_hop: 0, country: 0, edm: 0, alternative_rock: 0 },
        ":genreVotesTotal": 0,
        ":updatedAt": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
