import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const dbClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(dbClient, {
  marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
});

export const env = {
  eventsTableName: process.env.EVENTS_TABLE_NAME ?? "",
  requestsTableName: process.env.REQUESTS_TABLE_NAME ?? "",
  connectionsTableName: process.env.CONNECTIONS_TABLE_NAME ?? "",
  organizationsTableName: process.env.ORGANIZATIONS_TABLE_NAME ?? "",
  membershipsTableName: process.env.MEMBERSHIPS_TABLE_NAME ?? "",
  invitationsTableName: process.env.INVITATIONS_TABLE_NAME ?? "",
  bridgeDevicesTableName: process.env.BRIDGE_DEVICES_TABLE_NAME ?? "",
  billingEventsTableName: process.env.BILLING_EVENTS_TABLE_NAME ?? "",
  usageCountersTableName: process.env.USAGE_COUNTERS_TABLE_NAME ?? "",
  platformOperationsTableName: process.env.PLATFORM_OPERATIONS_TABLE_NAME ?? "",
  platformAlarmPrefix: process.env.PLATFORM_ALARM_PREFIX ?? "",
  asyncFailureQueueUrl: process.env.ASYNC_FAILURE_QUEUE_URL ?? "",
  userPoolId: process.env.USER_POOL_ID ?? "",
  brandAssetsBucketName: process.env.BRAND_ASSETS_BUCKET_NAME ?? "",
  websocketEndpoint: process.env.WEBSOCKET_ENDPOINT ?? "",
  paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  paypalEnvironment: process.env.PAYPAL_ENVIRONMENT ?? "sandbox",
  paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripeDjPriceId: process.env.STRIPE_DJ_PRICE_ID ?? process.env.STRIPE_PRICE_ID ?? "",
  stripeOrganizationPriceId: process.env.STRIPE_ORGANIZATION_PRICE_ID ?? "",
  appBaseUrl: process.env.APP_BASE_URL ?? "https://casperrequests.com",
};

export function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,x-push-token,x-device-id,stripe-signature",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

export function parseBody<T>(body?: string | null): T | null {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}
