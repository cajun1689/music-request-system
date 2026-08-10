import type {
  OrganizationEntitlements,
  OrganizationRecord,
  SaasPlanId,
} from "./types";

export const DEFAULT_TRIAL_DAYS = 14;

export const DJ_PLAN_ENTITLEMENTS: OrganizationEntitlements = {
  maxActiveEvents: 3,
  maxMembers: 1,
  maxBridgeDevices: 3,
  maxLibraryTracks: 25_000,
  maxWebsocketConnections: 500,
  retentionDays: 365,
  monthlyAiRequests: 5_000,
};

export const ORGANIZATION_PLAN_ENTITLEMENTS: OrganizationEntitlements = {
  maxActiveEvents: 20,
  maxMembers: 25,
  maxBridgeDevices: 25,
  maxLibraryTracks: 250_000,
  maxWebsocketConnections: 5_000,
  retentionDays: 730,
  monthlyAiRequests: 50_000,
};

export const DEFAULT_SAAS_ENTITLEMENTS = DJ_PLAN_ENTITLEMENTS;

export const PLAN_MONTHLY_PRICE_USD: Record<SaasPlanId, number> = {
  dj: 25,
  organization: 100,
};

export function entitlementsForPlan(planId: SaasPlanId): OrganizationEntitlements {
  return {
    ...(planId === "organization"
      ? ORGANIZATION_PLAN_ENTITLEMENTS
      : DJ_PLAN_ENTITLEMENTS),
  };
}

export const LEGACY_ENTITLEMENTS: OrganizationEntitlements = {
  maxActiveEvents: 100,
  maxMembers: 100,
  maxBridgeDevices: 100,
  maxLibraryTracks: 1_000_000,
  maxWebsocketConnections: 100_000,
  retentionDays: 3650,
  monthlyAiRequests: 1_000_000,
};

export function subscriptionAllowsUsage(status?: string): boolean {
  return status === "active" || status === "trialing";
}

export function organizationAllowsUsage(organization: OrganizationRecord): boolean {
  if (organization.accountStatus === "suspended" || organization.accountStatus === "deletion_pending") {
    return false;
  }
  if (subscriptionAllowsUsage(organization.subscriptionStatus)) return true;
  return organization.subscriptionStatus === "past_due"
    && Boolean(
      organization.gracePeriodEndsAt
      && Date.parse(organization.gracePeriodEndsAt) > Date.now(),
    );
}
