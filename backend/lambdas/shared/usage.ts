import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, env } from "./utils";

export async function incrementUsage(
  scopeId: string,
  counterKey: string,
  ttlSeconds: number,
): Promise<number> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.usageCountersTableName,
      Key: { scopeId, counterKey },
      UpdateExpression: "ADD #count :one SET expiresAt = :expiresAt, updatedAt = :now",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":expiresAt": Math.floor(Date.now() / 1000) + ttlSeconds,
        ":now": new Date().toISOString(),
      },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Number(result.Attributes?.count ?? 0);
}
