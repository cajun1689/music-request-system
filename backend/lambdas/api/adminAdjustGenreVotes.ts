import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord, GenreName, GenreVotes } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface AdminAdjustGenreVotesInput {
  adjustments?: Partial<Record<GenreName, number>>;
  set?: Partial<Record<GenreName, number>>;
}

const VALID_GENRES: GenreName[] = ["hip_hop", "country", "edm", "alternative_rock"];

function zeroedVotes(): GenreVotes {
  return { hip_hop: 0, country: 0, edm: 0, alternative_rock: 0 };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const input = parseBody<AdminAdjustGenreVotesInput>(event.body);
  if (!input || (!input.adjustments && !input.set)) {
    return json(400, { error: "adjustments or set is required" });
  }

  const cleanAdjustments: Partial<Record<GenreName, number>> = {};
  if (input.adjustments) {
    for (const key of Object.keys(input.adjustments) as GenreName[]) {
      if (!VALID_GENRES.includes(key)) continue;
      const value = Number(input.adjustments[key]);
      if (!Number.isFinite(value) || value === 0) continue;
      cleanAdjustments[key] = Math.round(value);
    }
  }

  const cleanSet: Partial<Record<GenreName, number>> = {};
  if (input.set) {
    for (const key of Object.keys(input.set) as GenreName[]) {
      if (!VALID_GENRES.includes(key)) continue;
      const value = Number(input.set[key]);
      if (!Number.isFinite(value) || value < 0) continue;
      cleanSet[key] = Math.round(value);
    }
  }

  const existing = await docClient.send(
    new GetCommand({ TableName: env.eventsTableName, Key: { eventId } }),
  );
  const record = existing.Item as EventRecord | undefined;
  if (!record) {
    return json(404, { error: "Event not found" });
  }

  const currentVotes: GenreVotes = {
    ...zeroedVotes(),
    ...(record.genreVotes ?? {}),
  };

  const nextVotes: GenreVotes = { ...currentVotes };
  for (const genre of VALID_GENRES) {
    if (genre in cleanSet) {
      nextVotes[genre] = cleanSet[genre] ?? 0;
    } else if (genre in cleanAdjustments) {
      nextVotes[genre] = Math.max(0, (currentVotes[genre] ?? 0) + (cleanAdjustments[genre] ?? 0));
    }
  }

  const nextTotal =
    nextVotes.hip_hop + nextVotes.country + nextVotes.edm + nextVotes.alternative_rock;

  const now = new Date().toISOString();
  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      ConditionExpression: "attribute_exists(eventId)",
      UpdateExpression:
        "SET genreVotes = :genreVotes, genreVotesTotal = :genreVotesTotal, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":genreVotes": nextVotes,
        ":genreVotesTotal": nextTotal,
        ":updatedAt": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
