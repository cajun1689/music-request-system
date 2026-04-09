import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { GenreName } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface SubmitGenreVoteInput {
  genre: GenreName;
  previousGenre?: GenreName;
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

  const isSwitch = input.previousGenre
    && VALID_GENRES.includes(input.previousGenre)
    && input.previousGenre !== input.genre;

  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      ConditionExpression: "attribute_exists(eventId)",
      UpdateExpression:
        "SET genreVotes = if_not_exists(genreVotes, :emptyVotes)",
      ExpressionAttributeValues: {
        ":emptyVotes": { hip_hop: 0, country: 0, edm: 0 },
      },
    }),
  );

  let updateExpr: string;
  let exprNames: Record<string, string>;
  let exprValues: Record<string, unknown>;

  if (isSwitch) {
    updateExpr =
      "SET genreVotes.#newGenre = genreVotes.#newGenre + :inc, genreVotes.#oldGenre = genreVotes.#oldGenre - :inc, updatedAt = :updatedAt";
    exprNames = { "#newGenre": input.genre, "#oldGenre": input.previousGenre! };
    exprValues = { ":inc": 1, ":updatedAt": now };
  } else {
    updateExpr =
      "SET genreVotes.#genre = genreVotes.#genre + :inc, genreVotesTotal = if_not_exists(genreVotesTotal, :zero) + :inc, updatedAt = :updatedAt";
    exprNames = { "#genre": input.genre };
    exprValues = { ":zero": 0, ":inc": 1, ":updatedAt": now };
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
