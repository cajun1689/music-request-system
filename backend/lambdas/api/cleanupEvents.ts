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
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.slice(i, i + 1000) },
        }),
      );
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

async function purgeOrganization(organization: OrganizationRecord): Promise<void> {
  const organizationId = organization.organizationId;
  if (organization.accountMode !== "saas") return;

  if (process.env.STRIPE_SECRET_KEY_SSM_PARAM || env.stripeSecretKey) {
    const stripe = await getStripe();
    if (organization.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(organization.stripeSubscriptionId).catch((error) => {
        console.warn("Could not cancel deleted organization subscription", String(error));
      });
    }
    if (organization.stripeConnectedAccountId) {
      await stripe.accounts.del(organization.stripeConnectedAccountId).catch((error) => {
        console.warn("Could not delete connected payout account", String(error));
      });
    }
    if (organization.stripeCustomerId) {
      await stripe.customers.del(organization.stripeCustomerId).catch((error) => {
        console.warn("Could not delete Stripe customer", String(error));
      });
    }
  }

  const eventItems = await queryKeys(
    env.eventsTableName,
    "organizationId = :organizationId",
    { ":organizationId": organizationId },
    "eventId",
    "organizationId-index",
  );
  for (const eventItem of eventItems) {
    const eventId = String(eventItem.eventId);
    const requestItems = await queryKeys(
      env.requestsTableName,
      "eventId = :eventId",
      { ":eventId": eventId },
      "eventId, requestId",
    );
    await batchDelete(
      env.requestsTableName,
      requestItems.map((item) => ({ eventId: item.eventId, requestId: item.requestId })),
    );
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
      "#scope = :scope",
      { ":scope": eventId },
      "#scope, counterKey",
      undefined,
      { "#scope": "scope" },
    ).catch(() => []);
    await batchDelete(
      env.usageCountersTableName,
      eventUsage.map((item) => ({ scope: item.scope, counterKey: item.counterKey })),
    );
  }
  await batchDelete(
    env.eventsTableName,
    eventItems.map((item) => ({ eventId: item.eventId })),
  );

  const [memberships, invitations, devices, organizationUsage] = await Promise.all([
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
      "#scope = :scope",
      { ":scope": organizationId },
      "#scope, counterKey",
      undefined,
      { "#scope": "scope" },
    ).catch(() => []),
  ]);
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
      organizationUsage.map((item) => ({ scope: item.scope, counterKey: item.counterKey })),
    ),
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
