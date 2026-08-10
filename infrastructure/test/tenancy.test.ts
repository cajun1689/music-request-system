import { membershipCanAccessEvent } from "../../backend/lambdas/shared/tenancy";
import { toPublicEvent } from "../../backend/lambdas/shared/publicEvent";
import { toPublicRequest } from "../../backend/lambdas/shared/publicRequest";
import { deviceCanAccessEvent } from "../../backend/lambdas/shared/bridgeAuth";
import {
  entitlementsForPlan,
  organizationAllowsUsage,
  PLAN_MONTHLY_PRICE_USD,
} from "../../backend/lambdas/shared/plans";
import type { OrganizationRecord } from "../../backend/lambdas/shared/types";
import type {
  EventRecord,
  OrganizationMembershipRecord,
} from "../../backend/lambdas/shared/types";

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    eventId: "event-a",
    name: "Test",
    date: "2026-08-10",
    venueName: "Venue",
    djBrandName: "DJ",
    primaryColor: "#000000",
    secondaryColor: "#111111",
    accentColor: "#ffffff",
    isActive: true,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function membership(
  organizationId: string,
  role: OrganizationMembershipRecord["role"] = "admin",
): OrganizationMembershipRecord {
  return {
    organizationId,
    userId: "user-1",
    email: "dj@example.com",
    role,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

describe("tenant isolation", () => {
  test("rejects a valid member from a different organization", () => {
    const target = event({ accountMode: "saas", organizationId: "org-b" });
    expect(membershipCanAccessEvent(target, membership("org-a"))).toBe(false);
  });

  test("enforces roles on a same-organization resource", () => {
    const target = event({ accountMode: "saas", organizationId: "org-a" });
    expect(membershipCanAccessEvent(target, membership("org-a", "dj"), ["owner", "admin"])).toBe(false);
    expect(membershipCanAccessEvent(target, membership("org-a", "admin"), ["owner", "admin"])).toBe(true);
  });

  test("retains the legacy Cognito compatibility lane", () => {
    const legacyEvent = event({ accountMode: "legacy", organizationId: "mapl-legacy" });
    expect(membershipCanAccessEvent(legacyEvent, null)).toBe(false);
    expect(membershipCanAccessEvent(legacyEvent, membership("mapl-legacy"))).toBe(true);
  });

  test("public event DTO strips credentials and private moderation state", () => {
    const publicEvent = toPublicEvent(
      event({
        accountMode: "saas",
        organizationId: "org-a",
        pushToken: "secret",
        blockedPushSources: ["source-a"],
        autoApproveList: ["song"],
        blockList: ["artist"],
      }),
    ) as Record<string, unknown>;
    expect(publicEvent.pushToken).toBeUndefined();
    expect(publicEvent.blockedPushSources).toBeUndefined();
    expect(publicEvent.autoApproveList).toBeUndefined();
    expect(publicEvent.blockList).toBeUndefined();
    expect(publicEvent.organizationId).toBeUndefined();
    expect(publicEvent.accountMode).toBe("saas");
  });

  test("legacy public DTO does not expose migration-only fields", () => {
    const publicEvent = toPublicEvent(
      event({ accountMode: "legacy", organizationId: "mapl-legacy" }),
    ) as Record<string, unknown>;
    expect(publicEvent.accountMode).toBeUndefined();
    expect(publicEvent.organizationId).toBeUndefined();
  });

  test("public request DTO strips tenant, payment, requester, and moderation secrets", () => {
    const publicRequest = toPublicRequest({
      eventId: "event-a",
      requestId: "request-a",
      songTitle: "Song",
      artistName: "Artist",
      requesterName: "Guest",
      message: "private note",
      organizationId: "org-a",
      paymentReference: "pi_secret",
      stripePaymentAttemptId: "attempt-secret",
      shoutout: "unapproved text",
      shoutoutApproved: false,
      shoutoutFlagReason: "moderation detail",
    }) as Record<string, unknown>;
    expect(publicRequest.requesterName).toBeUndefined();
    expect(publicRequest.message).toBeUndefined();
    expect(publicRequest.organizationId).toBeUndefined();
    expect(publicRequest.paymentReference).toBeUndefined();
    expect(publicRequest.stripePaymentAttemptId).toBeUndefined();
    expect(publicRequest.shoutout).toBeUndefined();
  });

  test("Bridge devices cannot cross event or organization boundaries", () => {
    const device = { organizationId: "org-a", eventId: "event-a", status: "active" as const };
    expect(deviceCanAccessEvent(device, { organizationId: "org-a", eventId: "event-a" })).toBe(true);
    expect(deviceCanAccessEvent(device, { organizationId: "org-b", eventId: "event-a" })).toBe(false);
    expect(deviceCanAccessEvent(device, { organizationId: "org-a", eventId: "event-b" })).toBe(false);
  });

  test("subscription enforcement preserves an explicit past-due grace period", () => {
    const organization = {
      accountStatus: "active",
      subscriptionStatus: "past_due",
      gracePeriodEndsAt: new Date(Date.now() + 60_000).toISOString(),
    } as OrganizationRecord;
    expect(organizationAllowsUsage(organization)).toBe(true);
    organization.gracePeriodEndsAt = new Date(Date.now() - 60_000).toISOString();
    expect(organizationAllowsUsage(organization)).toBe(false);
    organization.subscriptionStatus = "active";
    organization.accountStatus = "suspended";
    expect(organizationAllowsUsage(organization)).toBe(false);
  });

  test("publishes the requested prices with distinct plan limits", () => {
    expect(PLAN_MONTHLY_PRICE_USD).toEqual({ dj: 25, organization: 100 });
    expect(entitlementsForPlan("dj").maxMembers).toBe(1);
    expect(entitlementsForPlan("organization").maxMembers).toBeGreaterThan(1);
  });
});
