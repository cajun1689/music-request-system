import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const dbClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(dbClient);

export const env = {
  eventsTableName: process.env.EVENTS_TABLE_NAME ?? "",
  requestsTableName: process.env.REQUESTS_TABLE_NAME ?? "",
  connectionsTableName: process.env.CONNECTIONS_TABLE_NAME ?? "",
  brandAssetsBucketName: process.env.BRAND_ASSETS_BUCKET_NAME ?? "",
  websocketEndpoint: process.env.WEBSOCKET_ENDPOINT ?? "",
};

export function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
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
