import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import type { EventRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

const defaultLiveSources = (seratoLiveUrl?: string, rekordboxLiveUrl?: string) => [
  {
    id: "serato-a",
    name: "Serato A",
    type: "serato" as const,
    url: seratoLiveUrl ?? "",
    active: Boolean(seratoLiveUrl),
  },
  {
    id: "serato-b",
    name: "Serato B",
    type: "serato" as const,
    url: "",
    active: false,
  },
  {
    id: "rekordbox",
    name: "Rekordbox",
    type: "rekordbox" as const,
    url: rekordboxLiveUrl ?? "",
    active: Boolean(rekordboxLiveUrl),
  },
];

interface CreateEventInput {
  eventId?: string;
  name: string;
  slug?: string;
  isRecurring?: boolean;
  date: string;
  venueName: string;
  djBrandName: string;
  venueLogoUrl?: string;
  djLogoUrl?: string;
  seratoLiveUrl?: string;
  rekordboxLiveUrl?: string;
  livePlaylistSources?: EventRecord["livePlaylistSources"];
  tickerPromotions?: EventRecord["tickerPromotions"];
  fireSaleActive?: boolean;
  fireSaleMessage?: string;
  venmoHandle?: string;
  genreVotes?: EventRecord["genreVotes"];
  genreVotesTotal?: number;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const input = parseBody<CreateEventInput>(event.body);
  if (!input?.name || !input?.date || !input?.venueName || !input?.djBrandName) {
    return json(400, { error: "Missing required fields" });
  }

  const now = new Date().toISOString();
  const record: EventRecord = {
    eventId: input.eventId ?? randomUUID(),
    name: input.name,
    slug: input.slug,
    isRecurring: input.isRecurring ?? false,
    date: input.date,
    venueName: input.venueName,
    venueLogoUrl: input.venueLogoUrl,
    djBrandName: input.djBrandName,
    djLogoUrl: input.djLogoUrl,
    seratoLiveUrl: input.seratoLiveUrl,
    rekordboxLiveUrl: input.rekordboxLiveUrl,
    livePlaylistSources: input.livePlaylistSources ?? defaultLiveSources(input.seratoLiveUrl, input.rekordboxLiveUrl),
    tickerPromotions: input.tickerPromotions ?? [],
    fireSaleActive: input.fireSaleActive ?? false,
    fireSaleMessage: input.fireSaleMessage ?? "",
    venmoHandle: input.venmoHandle?.replace("@", ""),
    pushToken: randomUUID(),
    genreVotes: input.genreVotes ?? { hip_hop: 0, country: 0, edm: 0 },
    genreVotesTotal: input.genreVotesTotal ?? 0,
    primaryColor: input.primaryColor ?? "#0f172a",
    secondaryColor: input.secondaryColor ?? "#1e293b",
    accentColor: input.accentColor ?? "#f97316",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: env.eventsTableName,
      Item: record,
      ConditionExpression: "attribute_not_exists(eventId)",
    }),
  );

  return json(201, record);
};
