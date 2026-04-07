import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

const s3 = new S3Client({});

interface LibraryTrack {
  title: string;
  artist: string;
  playCount?: number;
}

interface SyncInput {
  tracks: LibraryTrack[];
  sourceId?: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) return json(400, { error: "eventId is required" });

  const pushToken =
    event.headers?.["x-push-token"] ?? event.headers?.["X-Push-Token"] ?? "";
  if (!pushToken) return json(401, { error: "Missing x-push-token header" });

  const input = parseBody<SyncInput>(event.body);
  if (!input?.tracks?.length) return json(400, { error: "tracks array is required" });

  const eventResponse = await docClient.send(
    new GetCommand({ TableName: env.eventsTableName, Key: { eventId } }),
  );
  const eventRecord = eventResponse.Item as EventRecord | undefined;
  if (!eventRecord) return json(404, { error: "Event not found" });

  if (!eventRecord.pushToken || eventRecord.pushToken !== pushToken) {
    return json(403, { error: "Invalid push token" });
  }

  const normalizedTracks = input.tracks.map((t) => ({
    title: t.title.trim(),
    artist: t.artist.trim(),
    titleNorm: normalize(t.title),
    artistNorm: normalize(t.artist),
    playCount: t.playCount ?? 0,
  }));

  const libraryData = {
    eventId,
    sourceId: input.sourceId || "all",
    syncedAt: new Date().toISOString(),
    trackCount: normalizedTracks.length,
    tracks: normalizedTracks,
  };

  const key = `libraries/${eventId}.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: env.brandAssetsBucketName,
      Key: key,
      Body: JSON.stringify(libraryData),
      ContentType: "application/json",
    }),
  );

  return json(200, {
    trackCount: normalizedTracks.length,
    message: `Library synced: ${normalizedTracks.length} tracks.`,
  });
};
