import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import type { EventRecord } from "../shared/types";
import type { OrganizationRecord } from "../shared/types";
import { organizationAllowsUsage } from "../shared/plans";
import {
  getCallerIdentity,
  requireOrganizationRole,
  authorizationResponse,
} from "../shared/tenancy";
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
  organizationId?: string;
  accountMode?: "legacy" | "saas";
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
  try {
    const input = parseBody<CreateEventInput>(event.body);
    const requestedSaas = input?.accountMode === "saas" || Boolean(input?.organizationId);
    if (
      !input?.name
      || !input?.date
      || (!requestedSaas && (!input.venueName || !input.djBrandName))
    ) {
      return json(400, { error: "Missing required fields" });
    }

    const caller = getCallerIdentity(event);
    const isSaas = requestedSaas;
    let saasOrganization: OrganizationRecord | undefined;
    if (isSaas) {
      if (!input.organizationId) {
        return json(400, { error: "organizationId is required for SaaS events" });
      }
      await requireOrganizationRole(event, input.organizationId, ["owner", "admin"]);
      const [organizationResult, eventsResult] = await Promise.all([
        docClient.send(
          new GetCommand({
            TableName: env.organizationsTableName,
            Key: { organizationId: input.organizationId },
          }),
        ),
        docClient.send(
          new QueryCommand({
            TableName: env.eventsTableName,
            IndexName: "organizationId-createdAt-index",
            KeyConditionExpression: "organizationId = :organizationId",
            FilterExpression: "isActive = :active",
            ExpressionAttributeValues: {
              ":organizationId": input.organizationId,
              ":active": true,
            },
            Select: "COUNT",
          }),
        ),
      ]);
      const organization = organizationResult.Item as OrganizationRecord | undefined;
      if (!organization) return json(404, { error: "Organization not found" });
      saasOrganization = organization;
      if (!organizationAllowsUsage(organization)) {
        return json(402, { error: "An active subscription or trial is required" });
      }
      if ((eventsResult.Count ?? 0) >= organization.entitlements.maxActiveEvents) {
        return json(409, { error: "This organization has reached its active-event limit" });
      }
    } else {
      await requireOrganizationRole(event, "mapl-legacy", ["owner", "admin", "dj"]);
    }

    const venueName = input.venueName || saasOrganization?.defaults.venueName || "";
    const djBrandName = input.djBrandName || saasOrganization?.defaults.djBrandName || "";
    if (!venueName || !djBrandName) {
      return json(400, { error: "venueName and djBrandName are required" });
    }
    const now = new Date().toISOString();
    const record: EventRecord = {
      eventId: input.eventId ?? randomUUID(),
      organizationId: input.organizationId,
      accountMode: isSaas ? "saas" : "legacy",
      createdBy: caller.userId,
      name: input.name,
      slug: input.slug,
      isRecurring: input.isRecurring ?? false,
      date: input.date,
      venueName,
      venueLogoUrl: input.venueLogoUrl || saasOrganization?.branding.logoUrl,
      djBrandName,
      djLogoUrl: input.djLogoUrl,
      seratoLiveUrl: input.seratoLiveUrl,
      rekordboxLiveUrl: input.rekordboxLiveUrl,
      livePlaylistSources: input.livePlaylistSources ?? defaultLiveSources(input.seratoLiveUrl, input.rekordboxLiveUrl),
      tickerPromotions: input.tickerPromotions ?? [],
      fireSaleActive: input.fireSaleActive ?? false,
      fireSaleMessage: input.fireSaleMessage ?? "",
      venmoHandle: input.venmoHandle?.replace("@", ""),
      pushToken: isSaas ? undefined : randomUUID(),
      genreVotes: input.genreVotes ?? { hip_hop: 0, country: 0, edm: 0, alternative_rock: 0 },
      genreVotesTotal: input.genreVotesTotal ?? 0,
      primaryColor: input.primaryColor ?? saasOrganization?.branding.primaryColor ?? "#0f172a",
      secondaryColor: input.secondaryColor ?? saasOrganization?.branding.secondaryColor ?? "#1e293b",
      accentColor: input.accentColor ?? saasOrganization?.branding.accentColor ?? "#f97316",
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
  } catch (error) {
    return authorizationResponse(error);
  }
};
