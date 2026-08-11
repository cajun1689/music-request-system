import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ScanCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { BatchWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { OrganizationRecord } from "../shared/types";
import { getStripe } from "../shared/stripe";
import { docClient, env } from "../shared/utils";

const DAYS_TO_KEEP = 3;
const s3 = new S3Client({});

async function batchDelete(
  tableName: string,
  keys: Array<Record<string, unknown>>,
): Promise<void> {
  for (let i = 0; i < keys.length; i += 25) {
    let requestItems: NonNullable<
      NonNullable<BatchWriteCommandInput["RequestItems"]>[string]
    > = keys.slice(i, i + 25).map((key) => ({
      DeleteRequest: { Key: key },
    }));
    let attempts = 0;
    do {
      const result = await docClient.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: requestItems },
        }),
      );
      requestItems = result.UnprocessedItems?.[tableName] ?? [];
      attempts++;
      if (requestItems.length && attempts >= 5) {
        throw new Error(`DynamoDB did not process ${requestItems.length} deletion(s) from ${tableName}`);
      }
    } while (requestItems.length);
  }
}

async function queryKeys(
  tableName: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, unknown>,
  projectionExpression: string,
  indexName?: string,
  expressionAttributeNames?: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ProjectionExpression: projectionExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function deleteObjectVersions(prefix: string): Promise<void> {
  const bucket = env.brandAssetsBucketName;
  if (!bucket) return;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );
    const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
      .filter((item): item is typeof item & { Key: string } => Boolean(item.Key))
      .map(({ Key, VersionId }) => ({ Key, VersionId }));
    for (let i = 0; i < objects.length; i += 1000) {
      const deleted = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.slice(i, i + 1000) },
        }),
      );
      if (deleted.Errors?.length) {
        throw new Error(
          `S3 failed to delete ${deleted.Errors.length} object version(s) under ${prefix}`,
        );
      }
    }
    keyMarker = page.NextKeyMarker;
    versionIdMarker = page.NextVersionIdMarker;
  } while (pageIsTruncated(keyMarker, versionIdMarker));
}

function pageIsTruncated(
  nextKeyMarker: string | undefined,
  nextVersionIdMarker: string | undefined,
): boolean {
  return Boolean(nextKeyMarker || nextVersionIdMarker);
}

function stripeResourceIsMissing(error: unknown): boolean {
  const stripeError = error as {
    statusCode?: number;
    code?: string;
    raw?: { statusCode?: number; code?: string };
  };
  return stripeError.statusCode === 404
    || stripeError.raw?.statusCode === 404
    || stripeError.code === "resource_missing"
    || stripeError.raw?.code === "resource_missing";
}

async function removeStripeResource(
  label: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (stripeResourceIsMissing(error)) {
      console.info(`Stripe ${label} was already removed`);
      return;
    }
    throw error;
  }
}

async function purgeOrganization(organization: OrganizationRecord): Promise<void> {
  const organizationId = organization.organizationId;
  if (organization.accountMode !== "saas") return;

  const hasStripeResources = Boolean(
    organization.stripeSubscriptionId
    || organization.stripeConnectedAccountId
    || organization.stripeCustomerId,
  );
  if (hasStripeResources && process.env.STRIPE_ENABLED !== "true") {
    throw new Error(
      `Cannot purge ${organizationId} while its Stripe resources are unavailable`,
    );
  }
  if (
    hasStripeResources
    && (process.env.STRIPE_SECRET_KEY_SSM_PARAM || env.stripeSecretKey)
  ) {
    const stripe = await getStripe();
    if (organization.stripeSubscriptionId) {
      await removeStripeResource(
        "subscription",
        () => stripe.subscriptions.cancel(organization.stripeSubscriptionId as string),
      );
    }
    if (organization.stripeConnectedAccountId) {
      await removeStripeResource(
        "connected account",
        () => stripe.accounts.del(organization.stripeConnectedAccountId as string),
      );
    }
    if (organization.stripeCustomerId) {
      await removeStripeResource(
        "customer",
        () => stripe.customers.del(organization.stripeCustomerId as string),
      );
    }
  }

  const eventItems = await queryKeys(
    env.eventsTableName,
    "organizationId = :organizationId",
    { ":organizationId": organizationId },
    "eventId",
    "organizationId-createdAt-index",
  );
  const organizationRequests = await queryKeys(
    env.requestsTableName,
    "organizationId = :organizationId",
    { ":organizationId": organizationId },
    "eventId, requestId",
    "organizationId-submittedAt-index",
  );
  await batchDelete(
    env.requestsTableName,
    organizationRequests.map((item) => ({
      eventId: item.eventId,
      requestId: item.requestId,
    })),
  );
  for (const eventItem of eventItems) {
    const eventId = String(eventItem.eventId);
    const connections = await queryKeys(
      env.connectionsTableName,
      "eventId = :eventId",
      { ":eventId": eventId },
      "connectionId",
      "eventId-index",
    );
    await batchDelete(
      env.connectionsTableName,
      connections.map((item) => ({ connectionId: item.connectionId })),
    );
    await deleteObjectVersions(`libraries/${eventId}.json`);
    const eventUsage = await queryKeys(
      env.usageCountersTableName,
      "scopeId = :scopeId",
      { ":scopeId": eventId },
      "scopeId, counterKey",
    );
    await batchDelete(
      env.usageCountersTableName,
      eventUsage.map((item) => ({ scopeId: item.scopeId, counterKey: item.counterKey })),
    );
  }
  await batchDelete(
    env.eventsTableName,
    eventItems.map((item) => ({ eventId: item.eventId })),
  );

  const [
    memberships,
    invitations,
    devices,
    organizationUsage,
    billingEvents,
    platformOperations,
  ] = await Promise.all([
    queryKeys(
      env.membershipsTableName,
      "organizationId = :organizationId",
      { ":organizationId": organizationId },
      "organizationId, userId",
    ),
    queryKeys(
      env.invitationsTableName,
      "organizationId = :organizationId",
      { ":organizationId": organizationId },
      "invitationId",
      "organizationId-index",
    ),
    queryKeys(
      env.bridgeDevicesTableName,
      "organizationId = :organizationId",
      { ":organizationId": organizationId },
      "deviceId",
      "organizationId-index",
    ),
    queryKeys(
      env.usageCountersTableName,
      "scopeId = :scopeId",
      { ":scopeId": organizationId },
      "scopeId, counterKey",
    ),
    queryKeys(
      env.billingEventsTableName,
      "organizationId = :organizationId",
      { ":organizationId": organizationId },
      "eventId",
      "organizationId-createdAt-index",
    ),
    queryKeys(
      env.platformOperationsTableName,
      "organizationId = :organizationId",
      { ":organizationId": organizationId },
      "recordId, recordType",
      "organizationId-createdAt-index",
    ),
  ]);
  for (const item of platformOperations.filter((record) => record.recordType === "audit")) {
    await docClient.send(
      new UpdateCommand({
        TableName: env.platformOperationsTableName,
        Key: { recordId: item.recordId },
        UpdateExpression:
          "SET organizationDeletedAt = :now "
          + "REMOVE reason, details, targetUserId, supportSessionId",
        ConditionExpression: "recordType = :audit",
        ExpressionAttributeValues: {
          ":now": new Date().toISOString(),
          ":audit": "audit",
        },
      }),
    );
  }
  await Promise.all([
    batchDelete(
      env.membershipsTableName,
      memberships.map((item) => ({ organizationId: item.organizationId, userId: item.userId })),
    ),
    batchDelete(
      env.invitationsTableName,
      invitations.map((item) => ({ invitationId: item.invitationId })),
    ),
    batchDelete(
      env.bridgeDevicesTableName,
      devices.map((item) => ({ deviceId: item.deviceId })),
    ),
    batchDelete(
      env.usageCountersTableName,
      organizationUsage.map((item) => ({ scopeId: item.scopeId, counterKey: item.counterKey })),
    ),
    batchDelete(
      env.billingEventsTableName,
      billingEvents.map((item) => ({ eventId: item.eventId })),
    ),
    batchDelete(
      env.platformOperationsTableName,
      platformOperations
        .filter((item) => item.recordType === "support_session")
        .map((item) => ({ recordId: item.recordId })),
    ),
    deleteObjectVersions(`organizations/${organizationId}/`),
    deleteObjectVersions(`${organizationId}/`),
  ]);

  await Promise.all([
    docClient.send(
      new DeleteCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId: `slug#${organization.slug}` },
      }),
    ),
    docClient.send(
      new DeleteCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
      }),
    ),
  ]);
}

export const handler = async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_TO_KEEP);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const events: Array<Record<string, unknown>> = [];
  let eventLastKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: env.eventsTableName,
        ProjectionExpression: "eventId, #d, isRecurring, #n, organizationId, accountMode",
        ExpressionAttributeNames: { "#d": "date", "#n": "name" },
        ExclusiveStartKey: eventLastKey,
      }),
    );
    events.push(...(result.Items ?? []));
    eventLastKey = result.LastEvaluatedKey;
  } while (eventLastKey);
  let deleted = 0;

  for (const evt of events) {
    if (evt.isRecurring) continue;

    const eventDate = (evt.date as string) ?? "";
    if (!eventDate) continue;

    if (evt.accountMode === "saas" && evt.organizationId) {
      const organizationResult = await docClient.send(
        new GetCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId: evt.organizationId },
        }),
      );
      const organization = organizationResult.Item as OrganizationRecord | undefined;
      const retentionCutoff = new Date();
      retentionCutoff.setDate(
        retentionCutoff.getDate() - (organization?.entitlements.retentionDays ?? 365),
      );
      if (eventDate > retentionCutoff.toISOString().slice(0, 10)) continue;
      await docClient.send(
        new UpdateCommand({
          TableName: env.eventsTableName,
          Key: { eventId: evt.eventId },
          UpdateExpression: "SET isActive = :inactive, archivedAt = :now, updatedAt = :now",
          ExpressionAttributeValues: {
            ":inactive": false,
            ":now": new Date().toISOString(),
          },
        }),
      );
      console.log("Archived SaaS event after retention period", {
        organizationId: evt.organizationId,
        eventId: evt.eventId,
      });
      continue;
    }

    if (eventDate > cutoffStr) continue;

    console.log(`Cleaning up expired event: ${evt.name} (${evt.eventId}), date=${eventDate}`);

    // Delete associated requests
    let lastKey: Record<string, unknown> | undefined;
    do {
      const reqResult = await docClient.send(
        new QueryCommand({
          TableName: env.requestsTableName,
          KeyConditionExpression: "eventId = :eid",
          ExpressionAttributeValues: { ":eid": evt.eventId },
          ProjectionExpression: "eventId, requestId",
          ExclusiveStartKey: lastKey,
        }),
      );

      const items = reqResult.Items ?? [];
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25);
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [env.requestsTableName]: chunk.map((item) => ({
                DeleteRequest: { Key: { eventId: item.eventId, requestId: item.requestId } },
              })),
            },
          }),
        );
      }
      lastKey = reqResult.LastEvaluatedKey;
    } while (lastKey);

    await docClient.send(
      new DeleteCommand({
        TableName: env.eventsTableName,
        Key: { eventId: evt.eventId },
      }),
    );
    deleted++;
  }

  const organizationsToPurge: OrganizationRecord[] = [];
  let organizationLastKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName: env.organizationsTableName,
        FilterExpression:
          "accountMode = :saas AND accountStatus = :pending AND deletionScheduledAt <= :now",
        ExpressionAttributeValues: {
          ":saas": "saas",
          ":pending": "deletion_pending",
          ":now": new Date().toISOString(),
        },
        ExclusiveStartKey: organizationLastKey,
      }),
    );
    organizationsToPurge.push(...((page.Items ?? []) as OrganizationRecord[]));
    organizationLastKey = page.LastEvaluatedKey;
  } while (organizationLastKey);

  for (const organization of organizationsToPurge) {
    await purgeOrganization(organization);
    console.log("Purged organization after recovery window", {
      organizationId: organization.organizationId,
    });
  }

  console.log(
    `Cleanup complete. Deleted ${deleted} expired events and purged ${organizationsToPurge.length} organizations.`,
  );
  return { deleted, organizationsPurged: organizationsToPurge.length };
};
