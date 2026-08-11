import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminResetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { entitlementsForPlan } from "../shared/plans";
import {
  createSupportSession,
  revokeSupportSession,
  validateSupportSession,
  writePlatformAudit,
} from "../shared/platformOperations";
import { getStripe } from "../shared/stripe";
import {
  AuthorizationError,
  authorizationResponse,
  requirePlatformAdmin,
} from "../shared/tenancy";
import type {
  OrganizationInvitationRecord,
  OrganizationMembershipRecord,
  OrganizationRecord,
  OrganizationRole,
  PlatformAuditRecord,
  PlatformSupportMode,
  PlatformSupportSessionRecord,
  RequestRecord,
  SaasPlanId,
} from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

const cognito = new CognitoIdentityProviderClient({});
const cloudWatch = new CloudWatchClient({});
const sqs = new SQSClient({});
const s3 = new S3Client({});
const MAPL_ORGANIZATION_ID = "mapl-legacy";
const MAX_PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 25;

class PlatformApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

type PlatformEvent = APIGatewayProxyEventV2 & {
  resource?: string;
  httpMethod?: string;
  path?: string;
};

type RouteHandler = (event: PlatformEvent) => Promise<APIGatewayProxyResultV2>;

interface OrganizationActionInput {
  action?:
    | "suspend"
    | "reactivate"
    | "extend_trial"
    | "change_plan"
    | "cancel_subscription"
    | "reactivate_subscription"
    | "schedule_deletion"
    | "cancel_deletion";
  reason?: string;
  planId?: SaasPlanId;
  days?: number;
  durationDays?: number;
  trialEndsAt?: string;
  parameters?: {
    planId?: SaasPlanId;
    days?: number;
    durationDays?: number;
    trialEndsAt?: string;
  };
}

function requireConfiguration(value: string, name: string): string {
  if (!value) throw new PlatformApiError(503, `${name} is not configured`);
  return value;
}

function requireReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) throw new PlatformApiError(400, "reason is required");
  return reason;
}

function pageLimit(value: string | undefined, fallback = 25): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PlatformApiError(400, "limit must be a positive integer");
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export function encodeCursor(value: Record<string, unknown> | undefined): string | undefined {
  return value
    ? Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
    : undefined;
}

export function decodeCursor(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new PlatformApiError(400, "cursor is invalid");
  }
}

async function queryAll(input: {
  tableName: string;
  indexName?: string;
  keyConditionExpression: string;
  expressionAttributeValues: Record<string, unknown>;
  expressionAttributeNames?: Record<string, string>;
  projectionExpression?: string;
  filterExpression?: string;
  scanIndexForward?: boolean;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new QueryCommand({
        TableName: input.tableName,
        IndexName: input.indexName,
        KeyConditionExpression: input.keyConditionExpression,
        ExpressionAttributeValues: input.expressionAttributeValues,
        ExpressionAttributeNames: input.expressionAttributeNames,
        ProjectionExpression: input.projectionExpression,
        FilterExpression: input.filterExpression,
        ScanIndexForward: input.scanIndexForward,
        Limit: input.limit ? Math.max(1, input.limit - items.length) : undefined,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey && (!input.limit || items.length < input.limit));
  return input.limit ? items.slice(0, input.limit) : items;
}

async function scanAll(input: {
  tableName: string;
  filterExpression?: string;
  expressionAttributeValues?: Record<string, unknown>;
  expressionAttributeNames?: Record<string, string>;
  projectionExpression?: string;
}): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName: input.tableName,
        FilterExpression: input.filterExpression,
        ExpressionAttributeValues: input.expressionAttributeValues,
        ExpressionAttributeNames: input.expressionAttributeNames,
        ProjectionExpression: input.projectionExpression,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function objectVersionManifest(prefix: string) {
  if (!env.brandAssetsBucketName) return [];
  const objects: Array<Record<string, unknown>> = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: env.brandAssetsBucketName,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    objects.push(
      ...(page.Versions ?? []).map((item) => ({
        key: item.Key,
        versionId: item.VersionId,
        isLatest: item.IsLatest,
        size: item.Size,
        lastModified: item.LastModified?.toISOString(),
        type: "version",
      })),
      ...(page.DeleteMarkers ?? []).map((item) => ({
        key: item.Key,
        versionId: item.VersionId,
        isLatest: item.IsLatest,
        lastModified: item.LastModified?.toISOString(),
        type: "delete_marker",
      })),
    );
    keyMarker = page.NextKeyMarker;
    versionIdMarker = page.NextVersionIdMarker;
  } while (keyMarker || versionIdMarker);
  return objects;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => {
        const normalized = key.toLowerCase();
        return !/(token|secret|password|credential|authorization|privatekey|apikey)/.test(
          normalized,
        );
      })
      .map(([key, item]) => [key, redactSecrets(item)]),
  );
}

export function isPlatformOrganizationItem(item: Record<string, unknown>): boolean {
  return !item.recordType && !String(item.organizationId ?? "").startsWith("slug#");
}

function publicAuditRecord(record: Record<string, unknown>) {
  return {
    ...record,
    auditId: record.recordId,
    id: record.recordId,
    timestamp: record.createdAt,
    metadata: record.details,
  };
}

function publicSupportSession(
  session: PlatformSupportSessionRecord | Record<string, unknown>,
  organizationName?: string,
) {
  const record = session as unknown as Record<string, unknown>;
  const revokedAt = typeof record.revokedAt === "string" ? record.revokedAt : undefined;
  const expiresAt = typeof record.expiresAtIso === "string"
    ? record.expiresAtIso
    : new Date(Number(record.expiresAt ?? 0) * 1000).toISOString();
  return {
    ...record,
    supportSessionId: String(record.recordId),
    organizationName,
    operatorUserId: record.actorUserId,
    operatorEmail: record.actorEmail,
    startedAt: record.createdAt,
    expiresAt,
    endedAt: revokedAt,
    status: revokedAt ? "revoked" : Date.parse(expiresAt) <= Date.now() ? "expired" : "active",
  };
}

async function getOrganizationOrThrow(organizationId: string): Promise<OrganizationRecord> {
  const result = await docClient.send(
    new GetCommand({
      TableName: env.organizationsTableName,
      Key: { organizationId },
    }),
  );
  if (!result.Item || String(result.Item.organizationId).startsWith("slug#")) {
    throw new PlatformApiError(404, "Organization not found");
  }
  return result.Item as OrganizationRecord;
}

export function organizationLifecycleIsProtected(
  organization: Pick<OrganizationRecord, "organizationId" | "accountMode">,
): boolean {
  return organization.organizationId === MAPL_ORGANIZATION_ID
    || organization.accountMode !== "saas";
}

async function organizationDetail(organizationId: string) {
  const organization = await getOrganizationOrThrow(organizationId);
  const [
    members,
    invitations,
    events,
    devices,
    usage,
    requests,
    billingEvents,
    recentAudit,
  ] = await Promise.all([
    queryAll({
      tableName: env.membershipsTableName,
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
    }),
    queryAll({
      tableName: env.invitationsTableName,
      indexName: "organizationId-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
      scanIndexForward: false,
    }),
    queryAll({
      tableName: env.eventsTableName,
      indexName: "organizationId-createdAt-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
      scanIndexForward: false,
    }),
    queryAll({
      tableName: env.bridgeDevicesTableName,
      indexName: "organizationId-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
      filterExpression: "attribute_not_exists(recordType)",
    }),
    queryAll({
      tableName: env.usageCountersTableName,
      keyConditionExpression: "scopeId = :scopeId",
      expressionAttributeValues: { ":scopeId": organizationId },
    }),
    queryAll({
      tableName: env.requestsTableName,
      indexName: "organizationId-submittedAt-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
    }),
    queryAll({
      tableName: env.billingEventsTableName,
      indexName: "organizationId-createdAt-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
      scanIndexForward: false,
      limit: 50,
    }),
    queryAll({
      tableName: requireConfiguration(
        env.platformOperationsTableName,
        "PLATFORM_OPERATIONS_TABLE_NAME",
      ),
      indexName: "organizationId-createdAt-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: {
        ":organizationId": organizationId,
        ":audit": "audit",
      },
      filterExpression: "recordType = :audit",
      scanIndexForward: false,
      limit: 50,
    }),
  ]);
  const requestRecords = requests as unknown as RequestRecord[];
  const statuses = requestRecords.reduce<Record<string, number>>((result, request) => {
    result[request.status] = (result[request.status] ?? 0) + 1;
    return result;
  }, {});
  const verifiedTips = requestRecords.filter((request) => request.paymentStatus === "verified");
  const staleBefore = Date.now() - 15 * 60 * 1000;
  const staleDevices = devices.filter((device) => {
    const lastSeenAt = Date.parse(String(device.lastSeenAt ?? ""));
    return !Number.isFinite(lastSeenAt) || lastSeenAt < staleBefore;
  });
  const failedBillingEvents = billingEvents.filter((billingEvent) =>
    ["failed", "error"].includes(String(billingEvent.status ?? "").toLowerCase()));
  const ownerEmail = (members as unknown as OrganizationMembershipRecord[])
    .find((member) => member.userId === organization.ownerUserId)?.email;
  return redactSecrets({
    organization: { ...organization, ownerEmail },
    members,
    invitations,
    events,
    devices,
    usage: Object.fromEntries(usage.map((counter) => [
      String(counter.counterKey),
      Number(counter.count ?? 0),
    ])),
    analytics: {
      requestCount: requestRecords.length,
      statuses,
      verifiedTipCount: verifiedTips.length,
      verifiedTipTotal: Number(
        verifiedTips.reduce((sum, request) => sum + Number(request.tipAmount ?? 0), 0).toFixed(2),
      ),
    },
    health: {
      status:
        organization.accountStatus !== "active"
        || failedBillingEvents.length > 0
          ? "attention"
          : "healthy",
      activeEventCount: events.filter((eventRecord) => eventRecord.isActive === true).length,
      bridgeDeviceCount: devices.length,
      staleBridgeDeviceCount: staleDevices.length,
      failedBillingEventCount: failedBillingEvents.length,
      accountStatus: organization.accountStatus ?? "active",
      subscriptionStatus: organization.subscriptionStatus ?? "not_configured",
    },
    billing: {
      stripeAvailable: stripeIsConfigured(),
      stripeConfigured: stripeIsConfigured(),
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      stripeConnectedAccountId: organization.stripeConnectedAccountId,
      connectDetailsSubmitted: organization.stripeConnectDetailsSubmitted ?? false,
      connectChargesEnabled: organization.stripeConnectChargesEnabled ?? false,
      connectPayoutsEnabled: organization.stripeConnectPayoutsEnabled ?? false,
      subscriptionStatus: organization.subscriptionStatus,
      planId: organization.planId,
      trialEndsAt: organization.trialEndsAt,
      gracePeriodEndsAt: organization.gracePeriodEndsAt,
      billingEventCount: billingEvents.length,
      latestBillingEventType: billingEvents[0]?.eventType,
      latestBillingEventStatus: billingEvents[0]?.status,
    },
    billingEvents: billingEvents.slice(0, 50),
    recentAudit: recentAudit.slice(0, 50).map(publicAuditRecord),
  });
}

async function getMe(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  return json(200, {
    access: {
      isPlatformAdmin: true,
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
    },
  });
}

async function infrastructureHealth() {
  const [alarmResult, queueResult] = await Promise.allSettled([
    cloudWatch.send(
      new DescribeAlarmsCommand({
        AlarmNamePrefix: env.platformAlarmPrefix || undefined,
        StateValue: "ALARM",
        MaxRecords: 50,
      }),
    ),
    env.asyncFailureQueueUrl
      ? sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: env.asyncFailureQueueUrl,
          AttributeNames: [
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
          ],
        }),
      )
      : Promise.resolve(null),
  ]);
  const activeAlarms = alarmResult.status === "fulfilled"
    ? (alarmResult.value.MetricAlarms ?? []).map((alarm) => ({
      name: alarm.AlarmName,
      reason: alarm.StateReason,
      updatedAt: alarm.StateUpdatedTimestamp?.toISOString(),
    }))
    : [];
  const queueAttributes = queueResult.status === "fulfilled"
    ? queueResult.value?.Attributes
    : undefined;
  const asyncFailureMessages = Number(queueAttributes?.ApproximateNumberOfMessages ?? 0);
  const asyncFailureInFlight = Number(
    queueAttributes?.ApproximateNumberOfMessagesNotVisible ?? 0,
  );
  return {
    status:
      alarmResult.status === "rejected" || queueResult.status === "rejected"
        ? "degraded"
        : activeAlarms.length > 0 || asyncFailureMessages > 0 || asyncFailureInFlight > 0
          ? "alarm"
          : "healthy",
    activeAlarmCount: activeAlarms.length,
    activeAlarms,
    asyncFailureMessages,
    asyncFailureInFlight,
    cloudWatchAvailable: alarmResult.status === "fulfilled",
    asyncFailureQueueAvailable: queueResult.status === "fulfilled" && Boolean(queueResult.value),
  };
}

async function getSummary(event: PlatformEvent) {
  await requirePlatformAdmin(event);
  const [
    organizations,
    memberships,
    events,
    activity,
    usageCounters,
    bridgeDevices,
    infrastructure,
  ] = await Promise.all([
    scanAll({
      tableName: env.organizationsTableName,
      filterExpression: "attribute_not_exists(recordType) AND NOT begins_with(organizationId, :slug)",
      expressionAttributeValues: { ":slug": "slug#" },
    }),
    scanAll({
      tableName: env.membershipsTableName,
      projectionExpression: "organizationId, userId",
    }),
    scanAll({
      tableName: env.eventsTableName,
      projectionExpression: "eventId, organizationId, #name, slug, isActive, createdAt, updatedAt",
      expressionAttributeNames: { "#name": "name" },
    }),
    queryAll({
      tableName: requireConfiguration(
        env.platformOperationsTableName,
        "PLATFORM_OPERATIONS_TABLE_NAME",
      ),
      indexName: "recordType-createdAt-index",
      keyConditionExpression: "recordType = :audit",
      expressionAttributeValues: { ":audit": "audit" },
      scanIndexForward: false,
      limit: 20,
    }),
    scanAll({
      tableName: env.usageCountersTableName,
      projectionExpression: "counterKey, #count",
      expressionAttributeNames: { "#count": "count" },
    }),
    scanAll({
      tableName: env.bridgeDevicesTableName,
      filterExpression: "attribute_not_exists(recordType)",
      projectionExpression: "deviceId, organizationId, #status, lastSeenAt",
      expressionAttributeNames: { "#status": "status" },
    }),
    infrastructureHealth(),
  ]);
  const status = organizations.reduce<Record<string, number>>((counts, item) => {
    const key = String(item.accountStatus ?? "active");
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const plan = organizations.reduce<Record<string, number>>((counts, item) => {
    const key = String(item.planId ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const recentActivity = activity
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20);
  const usage = usageCounters.reduce<Record<string, number>>((counts, item) => {
    const key = String(item.counterKey ?? "unknown");
    counts[key] = (counts[key] ?? 0) + Number(item.count ?? 0);
    return counts;
  }, {});
  const recentEvents = events
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20);
  const staleBridgeDeviceCount = bridgeDevices.filter((device) => {
    const lastSeenAt = Date.parse(String(device.lastSeenAt ?? ""));
    return device.status === "active"
      && (!Number.isFinite(lastSeenAt) || lastSeenAt < Date.now() - 15 * 60 * 1000);
  }).length;
  return json(200, {
    summary: redactSecrets({
      organizationCount: organizations.length,
      membershipCount: memberships.length,
      eventCount: events.length,
      activeEventCount: events.filter((item) => item.isActive === true).length,
      healthStatus: infrastructure.status,
      activeAlarmCount: infrastructure.activeAlarmCount,
      asyncFailureMessages: infrastructure.asyncFailureMessages,
      usageCounterTotal: Object.values(usage).reduce((sum, count) => sum + count, 0),
      bridgeDeviceCount: bridgeDevices.length,
      staleBridgeDeviceCount,
      stripeConfigured: stripeIsConfigured(),
      counts: {
        organizations: organizations.length,
        memberships: memberships.length,
        events: events.length,
        activeEvents: events.filter((item) => item.isActive === true).length,
      },
      status,
      plan,
      usage,
      activity: recentActivity,
      recentEvents,
      health: {
        databaseConfigured: Boolean(
          env.organizationsTableName
          && env.membershipsTableName
          && env.eventsTableName
          && env.requestsTableName,
        ),
        platformOperationsConfigured: Boolean(env.platformOperationsTableName),
        cognitoConfigured: Boolean(env.userPoolId),
        stripeConfigured: stripeIsConfigured(),
        bridgeDeviceCount: bridgeDevices.length,
        staleBridgeDeviceCount,
        generatedAt: new Date().toISOString(),
        ...infrastructure,
      },
    }),
  });
}

async function listOrganizations(event: PlatformEvent) {
  await requirePlatformAdmin(event);
  const query = event.queryStringParameters?.q?.trim().toLowerCase() ?? "";
  const status = event.queryStringParameters?.status?.trim();
  const plan = event.queryStringParameters?.plan?.trim();
  const limit = pageLimit(event.queryStringParameters?.limit);
  let lastKey = decodeCursor(event.queryStringParameters?.cursor);
  const organizations: Record<string, unknown>[] = [];
  let pages = 0;
  do {
    const remaining = limit - organizations.length;
    const values: Record<string, unknown> = { ":slug": "slug#" };
    const filters = [
      "attribute_not_exists(recordType)",
      "NOT begins_with(organizationId, :slug)",
    ];
    if (status) {
      filters.push("accountStatus = :status");
      values[":status"] = status;
    }
    if (plan) {
      filters.push("planId = :plan");
      values[":plan"] = plan;
    }
    const page = await docClient.send(
      new ScanCommand({
        TableName: env.organizationsTableName,
        FilterExpression: filters.join(" AND "),
        ExpressionAttributeValues: values,
        ExclusiveStartKey: lastKey,
        Limit: remaining,
      }),
    );
    const matches = (page.Items ?? []).filter((item) => {
      if (!isPlatformOrganizationItem(item)) return false;
      if (!query) return true;
      return [item.name, item.slug, item.organizationId]
        .some((value) => String(value ?? "").toLowerCase().includes(query));
    });
    organizations.push(...matches);
    lastKey = page.LastEvaluatedKey;
    pages++;
  } while (lastKey && organizations.length < limit && pages < MAX_SCAN_PAGES);
  return json(200, {
    organizations: redactSecrets(organizations),
    nextCursor: encodeCursor(lastKey),
  });
}

async function getOrganization(event: PlatformEvent) {
  await requirePlatformAdmin(event);
  const organizationId = event.pathParameters?.organizationId;
  if (!organizationId) throw new PlatformApiError(400, "organizationId is required");
  return json(200, await organizationDetail(organizationId));
}

function stripeIsConfigured(): boolean {
  return process.env.STRIPE_ENABLED === "true"
    && Boolean(process.env.STRIPE_SECRET_KEY_SSM_PARAM || env.stripeSecretKey);
}

async function requireStripeForOrganization(
  organization: OrganizationRecord,
): Promise<{ stripe: Stripe; subscription: Stripe.Subscription }> {
  if (!stripeIsConfigured()) throw new PlatformApiError(503, "Stripe is not configured");
  if (!organization.stripeSubscriptionId) {
    throw new PlatformApiError(409, "Organization has no Stripe subscription");
  }
  const stripe = await getStripe();
  const subscription = await stripe.subscriptions.retrieve(organization.stripeSubscriptionId);
  if ("deleted" in subscription && subscription.deleted) {
    throw new PlatformApiError(409, "Stripe subscription no longer exists");
  }
  return { stripe, subscription: subscription as Stripe.Subscription };
}

function planForStripeSubscription(subscription: Stripe.Subscription): SaasPlanId {
  const priceId = subscription.items.data[0]?.price.id;
  if (priceId && env.stripeOrganizationPriceId && priceId === env.stripeOrganizationPriceId) {
    return "organization";
  }
  if (priceId && env.stripeDjPriceId && priceId === env.stripeDjPriceId) return "dj";
  throw new PlatformApiError(
    503,
    `Stripe pricing for subscription price ${priceId ?? "(missing)"} is not configured`,
  );
}

async function storeAuthoritativeSubscription(
  organization: OrganizationRecord,
  subscription: Stripe.Subscription,
  planId: SaasPlanId,
) {
  const values: Record<string, unknown> = {
    ":subscriptionId": subscription.id,
    ":subscriptionStatus": subscription.status,
    ":planId": planId,
    ":entitlements": entitlementsForPlan(planId),
    ":trialEndsAt": subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
    ":now": new Date().toISOString(),
  };
  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.organizationsTableName,
      Key: { organizationId: organization.organizationId },
      ConditionExpression: "attribute_exists(organizationId)",
      UpdateExpression:
        "SET stripeSubscriptionId = :subscriptionId, subscriptionStatus = :subscriptionStatus, "
        + "planId = :planId, entitlements = :entitlements, trialEndsAt = :trialEndsAt, "
        + "updatedAt = :now",
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  );
  return result.Attributes as OrganizationRecord;
}

async function updateOrganizationAction(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const organizationId = event.pathParameters?.organizationId;
  if (!organizationId) throw new PlatformApiError(400, "organizationId is required");
  const input = parseBody<OrganizationActionInput>(event.body);
  if (!input?.action) throw new PlatformApiError(400, "A supported action is required");
  const reason = requireReason(input.reason);
  const organization = await getOrganizationOrThrow(organizationId);
  if (organizationLifecycleIsProtected(organization)) {
    throw new PlatformApiError(
      409,
      "Legacy MAPL account lifecycle and billing are protected from platform mutations",
    );
  }
  if (
    organization.accountStatus === "deletion_pending"
    && input.action !== "cancel_deletion"
  ) {
    throw new PlatformApiError(
      409,
      "Cancel scheduled deletion before making other lifecycle or billing changes",
    );
  }
  const now = new Date();
  let updated: OrganizationRecord;

  if (input.action === "suspend" || input.action === "reactivate") {
    if (organization.accountStatus === "deletion_pending") {
      throw new PlatformApiError(409, "Cancel scheduled deletion before changing account status");
    }
    const result = await docClient.send(
      new UpdateCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
        ConditionExpression:
          "attribute_exists(organizationId) AND "
          + "(attribute_not_exists(accountStatus) OR accountStatus <> :deletionPending)",
        UpdateExpression: input.action === "suspend"
          ? "SET accountStatus = :status, suspendedAt = :now, updatedAt = :now"
          : "SET accountStatus = :status, updatedAt = :now REMOVE suspendedAt",
        ExpressionAttributeValues: {
          ":status": input.action === "suspend" ? "suspended" : "active",
          ":deletionPending": "deletion_pending",
          ":now": now.toISOString(),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    updated = result.Attributes as OrganizationRecord;
  } else if (input.action === "change_plan") {
    const planId = input.parameters?.planId ?? input.planId;
    if (planId !== "dj" && planId !== "organization") {
      throw new PlatformApiError(400, "parameters.planId must be dj or organization");
    }
    const priceId = planId === "organization"
      ? env.stripeOrganizationPriceId
      : env.stripeDjPriceId;
    if (!priceId) throw new PlatformApiError(503, `${planId} Stripe pricing is not configured`);
    const { stripe, subscription } = await requireStripeForOrganization(organization);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) throw new PlatformApiError(409, "Stripe subscription has no billable item");
    const stripeSubscription = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: itemId, price: priceId }],
      metadata: { ...subscription.metadata, organizationId, planId },
      proration_behavior: "create_prorations",
    });
    updated = await storeAuthoritativeSubscription(organization, stripeSubscription, planId);
  } else if (input.action === "extend_trial") {
    const { stripe, subscription } = await requireStripeForOrganization(organization);
    const requestedDate = input.parameters?.trialEndsAt ?? input.trialEndsAt;
    const days = Number(
      input.parameters?.days
      ?? input.parameters?.durationDays
      ?? input.days
      ?? input.durationDays
      ?? 0,
    );
    let trialEndMs = requestedDate ? Date.parse(requestedDate) : Number.NaN;
    if (!requestedDate) {
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new PlatformApiError(
          400,
          "parameters.trialEndsAt or parameters.days from 1 through 365 is required",
        );
      }
      const currentEnd = subscription.trial_end
        ? subscription.trial_end * 1000
        : Date.now();
      trialEndMs = Math.max(currentEnd, Date.now()) + days * 24 * 60 * 60 * 1000;
    }
    if (!Number.isFinite(trialEndMs) || trialEndMs <= Date.now()) {
      throw new PlatformApiError(400, "Trial end must be a future date");
    }
    const stripeSubscription = await stripe.subscriptions.update(subscription.id, {
      trial_end: Math.floor(trialEndMs / 1000),
      metadata: { ...subscription.metadata, organizationId },
    });
    const planId = planForStripeSubscription(stripeSubscription);
    updated = await storeAuthoritativeSubscription(organization, stripeSubscription, planId);
  } else if (
    input.action === "cancel_subscription"
    || input.action === "reactivate_subscription"
  ) {
    const { stripe, subscription } = await requireStripeForOrganization(organization);
    const stripeSubscription = await stripe.subscriptions.update(subscription.id, {
      cancel_at_period_end: input.action === "cancel_subscription",
      metadata: { ...subscription.metadata, organizationId },
    });
    const planId = planForStripeSubscription(stripeSubscription);
    updated = await storeAuthoritativeSubscription(organization, stripeSubscription, planId);
  } else if (input.action === "schedule_deletion" || input.action === "cancel_deletion") {
    if (
      input.action === "schedule_deletion"
      && organization.accountStatus === "deletion_pending"
    ) {
      throw new PlatformApiError(409, "Organization deletion is already scheduled");
    }
    if (
      input.action === "cancel_deletion"
      && organization.accountStatus !== "deletion_pending"
    ) {
      throw new PlatformApiError(409, "Organization deletion is not scheduled");
    }
    if (organization.stripeSubscriptionId) {
      const { stripe, subscription } = await requireStripeForOrganization(organization);
      await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: input.action === "schedule_deletion",
        metadata: { ...subscription.metadata, organizationId },
      });
    }
    if (input.action === "schedule_deletion") {
      const scheduledAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = await docClient.send(
        new UpdateCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId },
          ConditionExpression: "attribute_exists(organizationId)",
          UpdateExpression:
            "SET accountStatus = :pending, deletionRequestedAt = :now, "
            + "deletionScheduledAt = :scheduledAt, "
            + "preDeletionAccountStatus = :previousStatus, updatedAt = :now",
          ExpressionAttributeValues: {
            ":pending": "deletion_pending",
            ":previousStatus":
              organization.accountStatus === "suspended" ? "suspended" : "active",
            ":now": now.toISOString(),
            ":scheduledAt": scheduledAt,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      updated = result.Attributes as OrganizationRecord;
    } else {
      const restoredStatus =
        organization.preDeletionAccountStatus === "suspended" || organization.suspendedAt
          ? "suspended"
          : "active";
      const result = await docClient.send(
        new UpdateCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId },
          ConditionExpression: "attribute_exists(organizationId)",
          UpdateExpression:
            "SET accountStatus = :status, updatedAt = :now "
            + "REMOVE deletionRequestedAt, deletionScheduledAt, preDeletionAccountStatus"
            + (restoredStatus === "active" ? ", suspendedAt" : ""),
          ExpressionAttributeValues: {
            ":status": restoredStatus,
            ":now": now.toISOString(),
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      updated = result.Attributes as OrganizationRecord;
    }
  } else {
    throw new PlatformApiError(400, "Unsupported organization action");
  }

  await writePlatformAudit({
    actor,
    action: `organization.${input.action}`,
    organizationId,
    reason,
    details: {
      parameters: input.parameters ?? {
        planId: input.planId,
        days: input.days ?? input.durationDays,
        trialEndsAt: input.trialEndsAt,
      },
      previousAccountStatus: organization.accountStatus,
      accountStatus: updated.accountStatus,
      previousPlanId: organization.planId,
      planId: updated.planId,
    },
  });
  return json(200, { organization: redactSecrets(updated) });
}

async function createInvitation(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const organizationId = event.pathParameters?.organizationId;
  if (!organizationId) throw new PlatformApiError(400, "organizationId is required");
  const input = parseBody<{ email?: string; role?: OrganizationRole; reason?: string }>(event.body);
  const email = input?.email?.trim().toLowerCase() ?? "";
  const reason = requireReason(input?.reason);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PlatformApiError(400, "A valid email is required");
  }
  if (input?.role !== "admin" && input?.role !== "dj") {
    throw new PlatformApiError(400, "role must be admin or dj");
  }
  await getOrganizationOrThrow(organizationId);
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const invitation: OrganizationInvitationRecord = {
    invitationId: randomUUID(),
    organizationId,
    email,
    role: input.role,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    invitedBy: actor.userId,
    expiresAt: Math.floor(now.getTime() / 1000) + 7 * 24 * 60 * 60,
    createdAt: now.toISOString(),
  };
  await docClient.send(
    new PutCommand({
      TableName: env.invitationsTableName,
      Item: invitation,
      ConditionExpression: "attribute_not_exists(invitationId)",
    }),
  );
  await writePlatformAudit({
    actor,
    action: "invitation.create",
    organizationId,
    reason,
    details: { invitationId: invitation.invitationId, email, role: invitation.role },
  });
  return json(201, {
    invitation: {
      ...redactSecrets(invitation) as Record<string, unknown>,
      inviteUrl: `${env.appBaseUrl}/invitations/${token}`,
    },
  });
}

function reasonFromBodyOrQuery(event: PlatformEvent): string {
  const input = parseBody<{ reason?: string }>(event.body);
  return requireReason(input?.reason ?? event.queryStringParameters?.reason);
}

async function deleteInvitation(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const organizationId = event.pathParameters?.organizationId;
  const invitationId = event.pathParameters?.invitationId;
  if (!organizationId || !invitationId) {
    throw new PlatformApiError(400, "organizationId and invitationId are required");
  }
  const reason = reasonFromBodyOrQuery(event);
  const result = await docClient.send(
    new GetCommand({
      TableName: env.invitationsTableName,
      Key: { invitationId },
    }),
  );
  if (!result.Item || result.Item.organizationId !== organizationId) {
    throw new PlatformApiError(404, "Invitation not found");
  }
  await docClient.send(
    new DeleteCommand({
      TableName: env.invitationsTableName,
      Key: { invitationId },
      ConditionExpression: "organizationId = :organizationId",
      ExpressionAttributeValues: { ":organizationId": organizationId },
    }),
  );
  await writePlatformAudit({
    actor,
    action: "invitation.delete",
    organizationId,
    reason,
    details: { invitationId, email: result.Item.email },
  });
  return json(200, { invitationId, deleted: true, revoked: true });
}

async function organizationMembers(organizationId: string) {
  return await queryAll({
    tableName: env.membershipsTableName,
    keyConditionExpression: "organizationId = :organizationId",
    expressionAttributeValues: { ":organizationId": organizationId },
  }) as unknown as OrganizationMembershipRecord[];
}

async function mutateMember(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const organizationId = event.pathParameters?.organizationId;
  const userId = event.pathParameters?.userId;
  if (!organizationId || !userId) {
    throw new PlatformApiError(400, "organizationId and userId are required");
  }
  const method = event.httpMethod ?? event.requestContext.http?.method ?? "";
  const input = parseBody<{
    role?: OrganizationRole;
    transferOwnership?: boolean;
    reason?: string;
  }>(event.body);
  const reason = requireReason(input?.reason ?? event.queryStringParameters?.reason);
  if (actor.userId === userId) {
    throw new PlatformApiError(409, "Platform administrators cannot change their own membership");
  }
  const [organization, members] = await Promise.all([
    getOrganizationOrThrow(organizationId),
    organizationMembers(organizationId),
  ]);
  const target = members.find((member) => member.userId === userId);
  if (!target) throw new PlatformApiError(404, "Member not found");
  const owners = members.filter((member) => member.role === "owner");
  const isDelete = method === "DELETE";
  const nextRole = input?.transferOwnership ? "owner" : input?.role;
  if (!isDelete && !["owner", "admin", "dj"].includes(nextRole ?? "")) {
    throw new PlatformApiError(400, "role must be owner, admin, or dj");
  }
  if (
    target.role === "owner"
    && (isDelete || nextRole !== "owner")
    && owners.length <= 1
  ) {
    throw new PlatformApiError(409, "The last organization owner cannot be removed or demoted");
  }
  const now = new Date().toISOString();

  if (isDelete) {
    const replacementOwner = target.role === "owner"
      ? owners.find((owner) => owner.userId !== userId)
      : undefined;
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: env.membershipsTableName,
              Key: { organizationId, userId },
              ConditionExpression: "attribute_exists(userId)",
            },
          },
          {
            Update: {
              TableName: env.organizationsTableName,
              Key: { organizationId },
              UpdateExpression:
                `SET updatedAt = :now${replacementOwner ? ", ownerUserId = :owner" : ""} `
                + "ADD memberCount :minusOne",
              ExpressionAttributeValues: {
                ":now": now,
                ":minusOne": -1,
                ...(replacementOwner ? { ":owner": replacementOwner.userId } : {}),
              },
            },
          },
        ],
      }),
    );
  } else if (nextRole === "owner" && target.role !== "owner") {
    const currentOwner = members.find(
      (member) => member.userId === organization.ownerUserId,
    ) ?? owners[0];
    const transactions = [
      ...(currentOwner && currentOwner.userId !== userId
        ? [{
            Update: {
              TableName: env.membershipsTableName,
              Key: { organizationId, userId: currentOwner.userId },
              UpdateExpression: "SET #role = :admin, updatedAt = :now",
              ExpressionAttributeNames: { "#role": "role" },
              ExpressionAttributeValues: { ":admin": "admin", ":now": now },
            },
          }]
        : []),
      {
        Update: {
          TableName: env.membershipsTableName,
          Key: { organizationId, userId },
          UpdateExpression: "SET #role = :owner, updatedAt = :now",
          ExpressionAttributeNames: { "#role": "role" },
          ExpressionAttributeValues: { ":owner": "owner", ":now": now },
        },
      },
      {
        Update: {
          TableName: env.organizationsTableName,
          Key: { organizationId },
          UpdateExpression: "SET ownerUserId = :userId, updatedAt = :now",
          ExpressionAttributeValues: { ":userId": userId, ":now": now },
        },
      },
    ];
    await docClient.send(new TransactWriteCommand({ TransactItems: transactions }));
  } else {
    const replacementOwner = target.role === "owner"
      ? owners.find((owner) => owner.userId !== userId)
      : undefined;
    const transactions = [
      {
        Update: {
          TableName: env.membershipsTableName,
          Key: { organizationId, userId },
          UpdateExpression: "SET #role = :role, updatedAt = :now",
          ExpressionAttributeNames: { "#role": "role" },
          ExpressionAttributeValues: { ":role": nextRole, ":now": now },
        },
      },
      ...(replacementOwner
        ? [{
            Update: {
              TableName: env.organizationsTableName,
              Key: { organizationId },
              UpdateExpression: "SET ownerUserId = :owner, updatedAt = :now",
              ExpressionAttributeValues: { ":owner": replacementOwner.userId, ":now": now },
            },
          }]
        : []),
    ];
    await docClient.send(new TransactWriteCommand({ TransactItems: transactions }));
  }
  await writePlatformAudit({
    actor,
    action: isDelete ? "member.delete" : "member.update",
    organizationId,
    targetUserId: userId,
    reason,
    details: { previousRole: target.role, role: isDelete ? null : nextRole },
  });
  return json(200, isDelete
    ? { userId, removed: true }
    : { membership: { ...target, role: nextRole, updatedAt: now } });
}

async function deleteDevice(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const organizationId = event.pathParameters?.organizationId;
  const deviceId = event.pathParameters?.deviceId;
  if (!organizationId || !deviceId) {
    throw new PlatformApiError(400, "organizationId and deviceId are required");
  }
  const reason = reasonFromBodyOrQuery(event);
  const result = await docClient.send(
    new GetCommand({
      TableName: env.bridgeDevicesTableName,
      Key: { deviceId },
    }),
  );
  if (!result.Item || result.Item.organizationId !== organizationId) {
    throw new PlatformApiError(404, "Device not found");
  }
  await docClient.send(
    new UpdateCommand({
      TableName: env.bridgeDevicesTableName,
      Key: { deviceId },
      ConditionExpression: "organizationId = :organizationId",
      UpdateExpression: "SET #status = :revoked, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":organizationId": organizationId,
        ":revoked": "revoked",
        ":now": new Date().toISOString(),
      },
    }),
  );
  await writePlatformAudit({
    actor,
    action: "device.revoke",
    organizationId,
    reason,
    details: { deviceId },
  });
  return json(200, { deviceId, revoked: true });
}

async function exportOrganization(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const organizationId = event.pathParameters?.organizationId;
  if (!organizationId) throw new PlatformApiError(400, "organizationId is required");
  const organization = await getOrganizationOrThrow(organizationId);
  const [
    memberships,
    invitations,
    devices,
    events,
    organizationUsage,
    billingEvents,
    platformOperations,
    organizationAssetVersions,
  ] = await Promise.all([
    organizationMembers(organizationId),
    queryAll({
      tableName: env.invitationsTableName,
      indexName: "organizationId-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
    }),
    queryAll({
      tableName: env.bridgeDevicesTableName,
      indexName: "organizationId-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
      filterExpression: "attribute_not_exists(recordType)",
    }),
    queryAll({
      tableName: env.eventsTableName,
      indexName: "organizationId-createdAt-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
    }),
    queryAll({
      tableName: env.usageCountersTableName,
      keyConditionExpression: "scopeId = :scopeId",
      expressionAttributeValues: { ":scopeId": organizationId },
    }),
    queryAll({
      tableName: env.billingEventsTableName,
      indexName: "organizationId-createdAt-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
      scanIndexForward: false,
    }),
    queryAll({
      tableName: env.platformOperationsTableName,
      indexName: "organizationId-createdAt-index",
      keyConditionExpression: "organizationId = :organizationId",
      expressionAttributeValues: { ":organizationId": organizationId },
      scanIndexForward: false,
    }),
    objectVersionManifest(`organizations/${organizationId}/`),
  ]);
  const [requestGroups, eventUsageGroups, libraryVersionGroups] = await Promise.all([
    Promise.all(events.map((eventRecord) =>
      queryAll({
        tableName: env.requestsTableName,
        keyConditionExpression: "eventId = :eventId",
        expressionAttributeValues: { ":eventId": eventRecord.eventId },
      }))),
    Promise.all(events.map((eventRecord) =>
      queryAll({
        tableName: env.usageCountersTableName,
        keyConditionExpression: "scopeId = :scopeId",
        expressionAttributeValues: { ":scopeId": eventRecord.eventId },
      }))),
    Promise.all(events.map((eventRecord) =>
      objectVersionManifest(`libraries/${eventRecord.eventId}.json`))),
  ]);
  const exportedAt = new Date().toISOString();
  await writePlatformAudit({
    actor,
    action: "organization.export",
    organizationId,
    reason: event.queryStringParameters?.reason?.trim() || "Platform data export",
    details: {
      eventCount: events.length,
      requestCount: requestGroups.reduce((sum, requests) => sum + requests.length, 0),
      usageCounterCount:
        organizationUsage.length
        + eventUsageGroups.reduce((sum, counters) => sum + counters.length, 0),
      billingEventCount: billingEvents.length,
      objectVersionCount:
        organizationAssetVersions.length
        + libraryVersionGroups.reduce((sum, objects) => sum + objects.length, 0),
    },
  }, { strict: true });
  return json(200, redactSecrets({
    exportedAt,
    organization,
    memberships,
    invitations,
    devices,
    events,
    requests: requestGroups.flat(),
    usageCounters: [...organizationUsage, ...eventUsageGroups.flat()],
    billingEvents,
    platformOperations,
    objectVersions: [...organizationAssetVersions, ...libraryVersionGroups.flat()],
  }));
}

function cognitoAttributes(user: UserType) {
  return Object.fromEntries((user.Attributes ?? []).map((attribute) => [
    attribute.Name ?? "",
    attribute.Value ?? "",
  ]));
}

async function listUsers(event: PlatformEvent) {
  await requirePlatformAdmin(event);
  const userPoolId = requireConfiguration(env.userPoolId, "USER_POOL_ID");
  const query = event.queryStringParameters?.q?.trim().toLowerCase() ?? "";
  const limit = Math.min(pageLimit(event.queryStringParameters?.limit), 60);
  const cursor = decodeCursor(event.queryStringParameters?.cursor);
  let paginationToken = typeof cursor?.paginationToken === "string"
    ? cursor.paginationToken
    : undefined;
  const users: UserType[] = [];
  let pages = 0;
  do {
    const page = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: Math.max(1, limit - users.length),
        PaginationToken: paginationToken,
      }),
    );
    users.push(...(page.Users ?? []).filter((user) => {
      if (!query) return true;
      const attributes = cognitoAttributes(user);
      return [user.Username, attributes.email, attributes.sub]
        .some((value) => String(value ?? "").toLowerCase().includes(query));
    }));
    paginationToken = page.PaginationToken;
    pages++;
  } while (paginationToken && users.length < limit && pages < MAX_SCAN_PAGES);
  const enriched = await Promise.all(users.map(async (user) => {
    const attributes = cognitoAttributes(user);
    const userId = attributes.sub || user.Username || "";
    const memberships = userId
      ? await queryAll({
          tableName: env.membershipsTableName,
          indexName: "userId-index",
          keyConditionExpression: "userId = :userId",
          expressionAttributeValues: { ":userId": userId },
        })
      : [];
    return {
      userId,
      username: user.Username,
      email: attributes.email,
      enabled: user.Enabled,
      status: user.UserStatus,
      createdAt: user.UserCreateDate?.toISOString(),
      updatedAt: user.UserLastModifiedDate?.toISOString(),
      memberships,
    };
  }));
  return json(200, {
    users: enriched,
    nextCursor: encodeCursor(paginationToken ? { paginationToken } : undefined),
  });
}

function escapeCognitoFilter(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

async function cognitoUserById(userId: string): Promise<UserType> {
  const page = await cognito.send(
    new ListUsersCommand({
      UserPoolId: requireConfiguration(env.userPoolId, "USER_POOL_ID"),
      Filter: `sub = "${escapeCognitoFilter(userId)}"`,
      Limit: 1,
    }),
  );
  const user = page.Users?.[0];
  if (!user?.Username) throw new PlatformApiError(404, "Cognito user not found");
  return user;
}

async function ensurePlatformAdminRemains(targetUserId: string) {
  const targetMembership = await docClient.send(
    new GetCommand({
      TableName: env.membershipsTableName,
      Key: { organizationId: MAPL_ORGANIZATION_ID, userId: targetUserId },
    }),
  );
  if (!["owner", "admin"].includes(String(targetMembership.Item?.role ?? ""))) return;
  const admins = (await organizationMembers(MAPL_ORGANIZATION_ID))
    .filter((member) =>
      member.userId !== targetUserId
      && (member.role === "owner" || member.role === "admin"));
  for (const admin of admins) {
    try {
      const user = await cognitoUserById(admin.userId);
      if (user.Username) {
        const state = await cognito.send(
          new AdminGetUserCommand({
            UserPoolId: requireConfiguration(env.userPoolId, "USER_POOL_ID"),
            Username: user.Username,
          }),
        );
        if (state.Enabled) return;
      }
    } catch (error) {
      if (!(error instanceof PlatformApiError && error.statusCode === 404)) throw error;
    }
  }
  throw new PlatformApiError(409, "Disabling this user would lock out platform administration");
}

async function userAction(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const userId = event.pathParameters?.userId;
  if (!userId) throw new PlatformApiError(400, "userId is required");
  const input = parseBody<{
    action?: "disable" | "enable" | "reset_password";
    reason?: string;
  }>(event.body);
  const reason = requireReason(input?.reason);
  if (!["disable", "enable", "reset_password"].includes(input?.action ?? "")) {
    throw new PlatformApiError(400, "action must be disable, enable, or reset_password");
  }
  const action = input?.action as "disable" | "enable" | "reset_password";
  if (action === "disable" && actor.userId === userId) {
    throw new PlatformApiError(409, "Platform administrators cannot disable themselves");
  }
  const user = await cognitoUserById(userId);
  const username = user.Username as string;
  const userPoolId = requireConfiguration(env.userPoolId, "USER_POOL_ID");
  if (action === "disable") {
    await ensurePlatformAdminRemains(userId);
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
  } else if (action === "enable") {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: username }));
  } else {
    await cognito.send(
      new AdminResetUserPasswordCommand({ UserPoolId: userPoolId, Username: username }),
    );
  }
  await writePlatformAudit({
    actor,
    action: `user.${action}`,
    targetUserId: userId,
    reason,
    details: { username },
  });
  return json(200, { userId, action, completed: true });
}

async function listAudit(event: PlatformEvent) {
  await requirePlatformAdmin(event);
  const tableName = requireConfiguration(
    env.platformOperationsTableName,
    "PLATFORM_OPERATIONS_TABLE_NAME",
  );
  const organizationId = event.queryStringParameters?.organizationId?.trim();
  const actorUserId = event.queryStringParameters?.actorUserId?.trim();
  const limit = pageLimit(event.queryStringParameters?.limit, 50);
  let lastKey = decodeCursor(event.queryStringParameters?.cursor);
  const records: Record<string, unknown>[] = [];
  let pages = 0;
  do {
    const remaining = limit - records.length;
    if (organizationId || actorUserId) {
      const useOrganization = Boolean(organizationId);
      const values: Record<string, unknown> = {
        ":partition": useOrganization ? organizationId : actorUserId,
        ":audit": "audit",
      };
      if (organizationId && actorUserId) values[":actor"] = actorUserId;
      const page = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: useOrganization
            ? "organizationId-createdAt-index"
            : "actorUserId-createdAt-index",
          KeyConditionExpression:
            `${useOrganization ? "organizationId" : "actorUserId"} = :partition`,
          FilterExpression:
            `recordType = :audit${organizationId && actorUserId ? " AND actorUserId = :actor" : ""}`,
          ExpressionAttributeValues: values,
          ScanIndexForward: false,
          Limit: remaining,
          ExclusiveStartKey: lastKey,
        }),
      );
      records.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    } else {
      const page = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "recordType-createdAt-index",
          KeyConditionExpression: "recordType = :audit",
          ExpressionAttributeValues: { ":audit": "audit" },
          ScanIndexForward: false,
          Limit: remaining,
          ExclusiveStartKey: lastKey,
        }),
      );
      records.push(...(page.Items ?? []));
      lastKey = page.LastEvaluatedKey;
    }
    pages++;
  } while (lastKey && records.length < limit && pages < MAX_SCAN_PAGES);
  records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const audit = records.map(publicAuditRecord);
  return json(200, { audit, records: audit, nextCursor: encodeCursor(lastKey) });
}

async function startSupportSession(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const input = parseBody<{
    organizationId?: string;
    targetUserId?: string;
    mode?: PlatformSupportMode;
    reason?: string;
    durationMinutes?: number;
  }>(event.body);
  const organizationId = input?.organizationId?.trim();
  if (!organizationId) throw new PlatformApiError(400, "organizationId is required");
  const targetUserId = input?.targetUserId;
  const mode = input?.mode;
  await getOrganizationOrThrow(organizationId);
  if (targetUserId) {
    const target = await docClient.send(
      new GetCommand({
        TableName: env.membershipsTableName,
        Key: { organizationId, userId: targetUserId },
      }),
    );
    if (!target.Item) {
      throw new PlatformApiError(400, "targetUserId is not a member of the organization");
    }
  }
  if (mode !== "read_only" && mode !== "support_write") {
    throw new PlatformApiError(400, "mode must be read_only or support_write");
  }
  const reason = requireReason(input?.reason);
  const durationMinutes = Number(input?.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 60) {
    throw new PlatformApiError(400, "durationMinutes must be an integer from 1 through 60");
  }
  const session = await createSupportSession({
    actor,
    organizationId,
    targetUserId,
    mode,
    reason,
    durationMinutes,
  });
  const supportSession = publicSupportSession(session, (await getOrganizationOrThrow(
    organizationId,
  )).name);
  return json(201, { session: supportSession, supportSession });
}

async function listSupportSessions(event: PlatformEvent) {
  await requirePlatformAdmin(event);
  const tableName = requireConfiguration(
    env.platformOperationsTableName,
    "PLATFORM_OPERATIONS_TABLE_NAME",
  );
  const records = await queryAll({
    tableName,
    indexName: "recordType-createdAt-index",
    keyConditionExpression: "recordType = :session",
    expressionAttributeValues: { ":session": "support_session" },
    scanIndexForward: false,
    limit: 100,
  });
  const organizationIds = [...new Set(records.map((record) => String(record.organizationId)))];
  const organizationNames = new Map<string, string>();
  await Promise.all(organizationIds.map(async (organizationId) => {
    try {
      organizationNames.set(organizationId, (await getOrganizationOrThrow(organizationId)).name);
    } catch (error) {
      if (!(error instanceof PlatformApiError && error.statusCode === 404)) throw error;
    }
  }));
  const sessions = records
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 100)
    .map((session) => {
      const publicSession = publicSupportSession(
        session,
        organizationNames.get(String(session.organizationId)),
      );
      return { ...publicSession, active: publicSession.status === "active" };
    });
  return json(200, { sessions, supportSessions: sessions });
}

async function supportSessionView(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) throw new PlatformApiError(400, "sessionId is required");
  const session = await validateSupportSession({
    sessionId,
    actorUserId: actor.userId,
  });
  const view = await organizationDetail(session.organizationId);
  await writePlatformAudit({
    actor,
    action: "support_session.access",
    organizationId: session.organizationId,
    targetUserId: session.targetUserId,
    supportSessionId: session.recordId,
    reason: session.reason,
    details: { mode: session.mode },
  }, { strict: true });
  const supportSession = publicSupportSession(
    session,
    (view as { organization?: { name?: string } }).organization?.name,
  );
  return json(200, {
    session: supportSession,
    supportSession,
    organization: (view as { organization?: unknown }).organization,
    data: view,
    view,
  });
}

async function endSupportSession(event: PlatformEvent) {
  const actor = await requirePlatformAdmin(event);
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) throw new PlatformApiError(400, "sessionId is required");
  const session = await revokeSupportSession({
    sessionId,
    actorUserId: actor.userId,
    allowAnyPlatformActor: true,
  });
  await writePlatformAudit({
    actor,
    action: "support_session.end",
    organizationId: session.organizationId,
    targetUserId: session.targetUserId,
    supportSessionId: session.recordId,
    reason: session.reason,
  });
  const supportSession = publicSupportSession(session);
  return json(200, {
    session: supportSession,
    supportSession,
    ended: true,
    revoked: true,
  });
}

const routes: Record<string, RouteHandler> = {
  "GET /platform/me": getMe,
  "GET /platform/summary": getSummary,
  "GET /platform/organizations": listOrganizations,
  "GET /platform/organizations/{organizationId}": getOrganization,
  "PATCH /platform/organizations/{organizationId}": updateOrganizationAction,
  "POST /platform/organizations/{organizationId}/invitations": createInvitation,
  "DELETE /platform/organizations/{organizationId}/invitations/{invitationId}": deleteInvitation,
  "PATCH /platform/organizations/{organizationId}/members/{userId}": mutateMember,
  "DELETE /platform/organizations/{organizationId}/members/{userId}": mutateMember,
  "DELETE /platform/organizations/{organizationId}/devices/{deviceId}": deleteDevice,
  "GET /platform/organizations/{organizationId}/export": exportOrganization,
  "GET /platform/users": listUsers,
  "POST /platform/users/{userId}/actions": userAction,
  "GET /platform/audit": listAudit,
  "POST /platform/support-sessions": startSupportSession,
  "GET /platform/support-sessions": listSupportSessions,
  "GET /platform/support-sessions/{sessionId}/view": supportSessionView,
  "DELETE /platform/support-sessions/{sessionId}": endSupportSession,
};

const routePatterns = Object.keys(routes).map((routeKey) => {
  const [method, path] = routeKey.split(" ", 2);
  const parameterNames: string[] = [];
  const pattern = path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    parameterNames.push(name);
    return "([^/]+)";
  });
  return {
    routeKey,
    method,
    parameterNames,
    regex: new RegExp(`^${pattern}$`),
  };
});

function eventMethod(event: PlatformEvent): string {
  return event.httpMethod ?? event.requestContext.http?.method ?? "";
}

function eventPath(event: PlatformEvent): string {
  return event.rawPath
    ?? event.path
    ?? event.requestContext.http?.path
    ?? event.resource
    ?? "";
}

function eventHeader(event: PlatformEvent, headerName: string): string | undefined {
  const normalizedName = headerName.toLowerCase();
  const match = Object.entries(event.headers ?? {}).find(
    ([name]) => name.toLowerCase() === normalizedName,
  );
  return match?.[1]?.trim() || undefined;
}

function organizationIdFromPlatformPath(path: string): string | undefined {
  const match = /^\/platform\/organizations\/([^/]+)/.exec(path);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function isSupportSessionControlPath(path: string): boolean {
  return path === "/platform/me"
    || path === "/platform/support-sessions"
    || /^\/platform\/support-sessions\/[^/]+(?:\/view)?$/.test(path);
}

function isAllowlistedSupportWrite(method: string, path: string): boolean {
  return (
    method === "POST"
    && /^\/platform\/organizations\/[^/]+\/invitations$/.test(path)
  ) || (
    method === "DELETE"
    && /^\/platform\/organizations\/[^/]+\/invitations\/[^/]+$/.test(path)
  ) || (
    ["PATCH", "DELETE"].includes(method)
    && /^\/platform\/organizations\/[^/]+\/members\/[^/]+$/.test(path)
  ) || (
    method === "DELETE"
    && /^\/platform\/organizations\/[^/]+\/devices\/[^/]+$/.test(path)
  );
}

function resolveRoute(event: PlatformEvent): {
  handler: RouteHandler;
  event: PlatformEvent;
} | null {
  const method = eventMethod(event);
  const resource = event.resource ?? event.routeKey?.replace(/^[A-Z]+ /, "") ?? event.rawPath;
  const direct = routes[`${method} ${resource}`];
  if (direct) return { handler: direct, event };
  const requestPath = eventPath(event);
  for (const candidate of routePatterns) {
    if (candidate.method !== method) continue;
    const match = candidate.regex.exec(requestPath);
    if (!match) continue;
    const pathParameters = { ...(event.pathParameters ?? {}) };
    candidate.parameterNames.forEach((name, index) => {
      pathParameters[name] = decodeURIComponent(match[index + 1]);
    });
    return {
      handler: routes[candidate.routeKey],
      event: { ...event, pathParameters },
    };
  }
  return null;
}

export const handler: APIGatewayProxyHandlerV2 = async (rawEvent) => {
  const platformEvent = rawEvent as PlatformEvent;
  const path = eventPath(platformEvent);
  const method = eventMethod(platformEvent);
  const supportSessionId = eventHeader(platformEvent, "x-support-session-id");
  let mutationIntent: PlatformAuditRecord | undefined;
  let mutationActor: Awaited<ReturnType<typeof requirePlatformAdmin>> | undefined;
  try {
    const resolved = resolveRoute(platformEvent);
    if (!resolved) return json(404, { error: "Platform API route not found" });
    let supportContext: PlatformSupportSessionRecord | undefined;
    let supportActor: Awaited<ReturnType<typeof requirePlatformAdmin>> | undefined;
    if (supportSessionId && !isSupportSessionControlPath(path)) {
      supportActor = await requirePlatformAdmin(platformEvent);
      const requireWrite = !["GET", "HEAD", "OPTIONS"].includes(method);
      const organizationId = organizationIdFromPlatformPath(path);
      if (!organizationId) {
        throw new AuthorizationError(
          "Customer support mode only permits organization-scoped operations",
        );
      }
      if (requireWrite && !isAllowlistedSupportWrite(method, path)) {
        throw new AuthorizationError(
          "This operation is not permitted through customer support mode",
        );
      }
      supportContext = await validateSupportSession({
        sessionId: supportSessionId,
        actorUserId: supportActor.userId,
        organizationId,
        requireWrite,
      });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutationActor = supportActor ?? await requirePlatformAdmin(platformEvent);
      const body = parseBody<{ reason?: string }>(platformEvent.body);
      mutationIntent = await writePlatformAudit({
        actor: mutationActor,
        action: "platform.mutation.intent",
        organizationId: organizationIdFromPlatformPath(path),
        supportSessionId,
        reason:
          body?.reason?.trim()
          || platformEvent.queryStringParameters?.reason?.trim()
          || "Platform mutation request",
        outcome: "pending",
        details: { method, path },
      }, { strict: true });
    }
    const response = await resolved.handler(resolved.event);
    if (mutationIntent && mutationActor) {
      const statusCode = typeof response === "object" && response
        ? Number((response as { statusCode?: number }).statusCode ?? 200)
        : 200;
      await writePlatformAudit({
        actor: mutationActor,
        action: "platform.mutation.completed",
        organizationId: mutationIntent.organizationId,
        supportSessionId,
        reason: mutationIntent.reason,
        outcome: statusCode >= 400 ? "failure" : "success",
        details: {
          method,
          path,
          statusCode,
          intentAuditId: mutationIntent.recordId,
        },
      });
    }
    if (supportContext && supportActor) {
      await writePlatformAudit({
        actor: supportActor,
        action: method === "GET" ? "support_session.read" : "support_session.write",
        organizationId: supportContext.organizationId,
        targetUserId: supportContext.targetUserId,
        supportSessionId: supportContext.recordId,
        reason: supportContext.reason,
        details: { method, path },
      });
    }
    return response;
  } catch (error) {
    try {
      const actor = mutationActor ?? await requirePlatformAdmin(platformEvent);
      const body = parseBody<{ reason?: string }>(platformEvent.body);
      await writePlatformAudit({
        actor,
        action: mutationIntent ? "platform.mutation.completed" : "platform.request.failed",
        organizationId: organizationIdFromPlatformPath(path),
        supportSessionId,
        reason: body?.reason?.trim(),
        outcome: "failure",
        details: {
          method,
          path,
          intentAuditId: mutationIntent?.recordId,
          statusCode:
            error instanceof PlatformApiError || error instanceof AuthorizationError
              ? error.statusCode
              : 500,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } catch (auditError) {
      console.warn("platformApi: failed request could not be audited", {
        error: String(auditError),
      });
    }
    if (error instanceof PlatformApiError) {
      return json(error.statusCode, { error: error.message });
    }
    if (error instanceof AuthorizationError) return authorizationResponse(error);
    console.error("platformApi: request failed", {
      routeKey: rawEvent.routeKey,
      rawPath: eventPath(platformEvent),
      error: String(error),
    });
    return json(500, { error: "Platform API request failed" });
  }
};

export const platformApiTestExports = {
  resolveRoute,
  redactSecrets,
  organizationDetail,
  queryAll,
  scanAll,
  isAllowlistedSupportWrite,
};
