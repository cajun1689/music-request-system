import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { GenreName } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface SubmitGenreVoteInput {
  genre: GenreName;
}

const VALID_GENRES: GenreName[] = ["hip_hop", "country", "edm"];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const input = parseBody<SubmitGenreVoteInput>(event.body);
  if (!input?.genre || !VALID_GENRES.includes(input.genre)) {
    return json(400, { error: "genre must be one of hip_hop, country, edm" });
  }

  const now = new Date().toISOString();
  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      ConditionExpression: "attribute_exists(eventId)",
      UpdateExpression:
        "SET genreVotes.#genre = if_not_exists(genreVotes.#genre, :zero) + :inc, genreVotesTotal = if_not_exists(genreVotesTotal, :zero) + :inc, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#genre": input.genre,
      },
      ExpressionAttributeValues: {
        ":zero": 0,
        ":inc": 1,
        ":updatedAt": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
