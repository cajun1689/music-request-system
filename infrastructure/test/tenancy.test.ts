import {
  membershipCanAccessEvent,
  membershipCanAccessPlatform,
} from "../../backend/lambdas/shared/tenancy";
import {
  createSupportSession,
  supportSessionAccessError,
  writePlatformAudit,
} from "../../backend/lambdas/shared/platformOperations";
import {
  isPlatformOrganizationItem,
  organizationLifecycleIsProtected,
  platformApiTestExports,
} from "../../backend/lambdas/api/platformApi";
import {
  stripeWebhookTestExports,
  subscriptionPlanForPrice,
} from "../../backend/lambdas/api/stripeWebhook";
import { docClient, env } from "../../backend/lambdas/shared/utils";
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
  PlatformSupportSessionRecord,
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

  test("limits platform access to MAPL owners and admins", () => {
    expect(membershipCanAccessPlatform(membership("mapl-legacy", "owner"))).toBe(true);
    expect(membershipCanAccessPlatform(membership("mapl-legacy", "admin"))).toBe(true);
    expect(membershipCanAccessPlatform(membership("mapl-legacy", "dj"))).toBe(false);
    expect(membershipCanAccessPlatform(membership("saas-org", "owner"))).toBe(false);
    expect(membershipCanAccessPlatform(null)).toBe(false);
  });

  test("support sessions enforce actor, tenant, expiry, revocation, and write mode", () => {
    const session: PlatformSupportSessionRecord = {
      recordId: "support#one",
      recordType: "support_session",
      actorUserId: "operator-a",
      actorEmail: "operator@example.com",
      organizationId: "org-a",
      mode: "read_only",
      reason: "Ticket 123",
      createdAt: "2026-08-10T00:00:00.000Z",
      expiresAt: 2_000_000_000,
      expiresAtIso: "2033-05-18T03:33:20.000Z",
      retentionExpiresAt: 2_100_000_000,
    };
    expect(supportSessionAccessError(session, {
      actorUserId: "operator-a",
      organizationId: "org-a",
      now: 1_900_000_000_000,
    })).toBeUndefined();
    expect(supportSessionAccessError(session, {
      actorUserId: "operator-b",
      now: 1_900_000_000_000,
    })).toMatch(/another administrator/);
    expect(supportSessionAccessError(session, {
      actorUserId: "operator-a",
      organizationId: "org-b",
      now: 1_900_000_000_000,
    })).toMatch(/not valid/);
    expect(supportSessionAccessError(session, {
      actorUserId: "operator-a",
      requireWrite: true,
      now: 1_900_000_000_000,
    })).toMatch(/read-only/);
    expect(supportSessionAccessError(session, {
      actorUserId: "operator-a",
      now: 2_100_000_000_000,
    })).toMatch(/expired/);
    expect(supportSessionAccessError(
      { ...session, revokedAt: "2026-08-10T01:00:00.000Z" },
      { actorUserId: "operator-a", now: 1_900_000_000_000 },
    )).toMatch(/ended/);
  });

  test("platform audit records include outcome and source IP", async () => {
    const previousTable = env.platformOperationsTableName;
    env.platformOperationsTableName = "PlatformOperations";
    const send = jest.spyOn(docClient, "send").mockResolvedValueOnce({} as never);
    try {
      const audit = await writePlatformAudit({
        actor: {
          userId: "operator-a",
          email: "operator@example.com",
          sourceIp: "203.0.113.10",
        },
        action: "organization.suspend",
        organizationId: "org-a",
        reason: "Support case 123",
      });
      expect(audit.outcome).toBe("success");
      expect(audit.sourceIp).toBe("203.0.113.10");
      const command = send.mock.calls[0]?.[0] as {
        input?: { Item?: Record<string, unknown>; ConditionExpression?: string };
      };
      expect(command.input?.Item).toMatchObject({
        action: "organization.suspend",
        outcome: "success",
        sourceIp: "203.0.113.10",
      });
      expect(command.input?.ConditionExpression).toContain("attribute_not_exists");
    } finally {
      send.mockRestore();
      env.platformOperationsTableName = previousTable;
    }
  });

  test("audit intents fail closed before privileged mutations", async () => {
    const previousTable = env.platformOperationsTableName;
    env.platformOperationsTableName = "PlatformOperations";
    const send = jest.spyOn(docClient, "send").mockRejectedValueOnce(new Error("audit unavailable"));
    try {
      await expect(writePlatformAudit({
        actor: { userId: "operator-a", email: "operator@example.com" },
        action: "platform.mutation.intent",
        organizationId: "org-a",
        outcome: "pending",
      }, { strict: true })).rejects.toThrow("audit unavailable");
    } finally {
      send.mockRestore();
      env.platformOperationsTableName = previousTable;
    }
  });

  test("support-session creation atomically writes its start audit", async () => {
    const previousTable = env.platformOperationsTableName;
    env.platformOperationsTableName = "PlatformOperations";
    const send = jest.spyOn(docClient, "send").mockResolvedValueOnce({} as never);
    try {
      const session = await createSupportSession({
        actor: { userId: "operator-a", email: "operator@example.com" },
        organizationId: "org-a",
        mode: "read_only",
        reason: "Investigate event setup",
        durationMinutes: 30,
      });
      const command = send.mock.calls[0]?.[0] as {
        input?: { TransactItems?: Array<{ Put?: { Item?: Record<string, unknown> } }> };
      };
      expect(command.input?.TransactItems).toHaveLength(2);
      expect(command.input?.TransactItems?.[0]?.Put?.Item).toMatchObject({
        recordId: session.recordId,
        recordType: "support_session",
      });
      expect(session.retentionExpiresAt).toBeGreaterThan(session.expiresAt);
      expect(command.input?.TransactItems?.[1]?.Put?.Item).toMatchObject({
        recordType: "audit",
        action: "support_session.start",
        supportSessionId: session.recordId,
        outcome: "success",
      });
    } finally {
      send.mockRestore();
      env.platformOperationsTableName = previousTable;
    }
  });

  test("platform proxy router resolves REST API proxy paths and decodes parameters", () => {
    const restEvent = {
      httpMethod: "PATCH",
      resource: "/platform/{proxy+}",
      path: "/platform/organizations/org%20a",
      requestContext: {},
      headers: {},
    } as never;
    const resolved = platformApiTestExports.resolveRoute(restEvent);
    expect(resolved).not.toBeNull();
    expect(resolved?.event.pathParameters?.organizationId).toBe("org a");
  });

  test("platform responses recursively redact credentials", () => {
    expect(platformApiTestExports.redactSecrets({
      name: "Visible",
      pushToken: "hidden",
      nested: { tokenHash: "hidden", deviceToken: "hidden", value: "visible" },
    })).toEqual({
      name: "Visible",
      nested: { value: "visible" },
    });
  });

  test("keeps the legacy MAPL account out of SaaS lifecycle mutations", () => {
    expect(organizationLifecycleIsProtected({
      organizationId: "mapl-legacy",
      accountMode: "legacy",
    })).toBe(true);
    expect(organizationLifecycleIsProtected({
      organizationId: "org-saas",
      accountMode: "saas",
    })).toBe(false);
  });

  test("excludes organization slug-reservation records from platform listings", () => {
    expect(isPlatformOrganizationItem({
      organizationId: "org-a",
      accountMode: "saas",
    })).toBe(true);
    expect(isPlatformOrganizationItem({
      organizationId: "slug#org-a",
      recordType: "slug-reservation",
    })).toBe(false);
  });

  test("limits elevated support writes to the customer-scoped allowlist", () => {
    const allowed = platformApiTestExports.isAllowlistedSupportWrite;
    expect(allowed("POST", "/platform/organizations/org-a/invitations")).toBe(true);
    expect(allowed("PATCH", "/platform/organizations/org-a/members/user-a")).toBe(true);
    expect(allowed("DELETE", "/platform/organizations/org-a/devices/device-a")).toBe(true);
    expect(allowed("PATCH", "/platform/organizations/org-a")).toBe(false);
    expect(allowed("POST", "/platform/users/user-a/actions")).toBe(false);
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

  test("rejects unrecognized Stripe prices instead of silently downgrading plans", () => {
    expect(subscriptionPlanForPrice("price_dj", "price_dj", "price_org")).toBe("dj");
    expect(subscriptionPlanForPrice("price_org", "price_dj", "price_org")).toBe("organization");
    expect(() => subscriptionPlanForPrice("price_unknown", "price_dj", "price_org"))
      .toThrow(/unknown price/);
  });

  test("subscription webhooks preserve an organization pending deletion", async () => {
    const previousTable = env.organizationsTableName;
    const previousDjPrice = env.stripeDjPriceId;
    env.organizationsTableName = "Organizations";
    env.stripeDjPriceId = "price_dj";
    const send = jest.spyOn(docClient, "send")
      .mockRejectedValueOnce(Object.assign(new Error("condition"), {
        name: "ConditionalCheckFailedException",
      }))
      .mockResolvedValueOnce({} as never);
    try {
      await stripeWebhookTestExports.updateSubscription({
        id: "sub_123",
        metadata: { organizationId: "org-a" },
        status: "active",
        trial_end: null,
        items: { data: [{ price: { id: "price_dj" } }] },
      } as never, 1234);
      const first = send.mock.calls[0]?.[0] as { input?: {
        ConditionExpression?: string;
        UpdateExpression?: string;
      } };
      const retry = send.mock.calls[1]?.[0] as { input?: { UpdateExpression?: string } };
      expect(first.input?.ConditionExpression).toContain("accountStatus <> :deletionPending");
      expect(first.input?.ConditionExpression).toContain("attribute_not_exists(suspendedAt)");
      expect(first.input?.UpdateExpression).toContain("accountStatus = :accountStatus");
      expect(retry.input?.UpdateExpression).not.toContain("accountStatus = :accountStatus");
    } finally {
      send.mockRestore();
      env.organizationsTableName = previousTable;
      env.stripeDjPriceId = previousDjPrice;
    }
  });
});
