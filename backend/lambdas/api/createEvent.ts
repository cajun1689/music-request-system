import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import type { EventRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

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
  venmoHandle?: string;
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
    venmoHandle: input.venmoHandle?.replace("@", ""),
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
