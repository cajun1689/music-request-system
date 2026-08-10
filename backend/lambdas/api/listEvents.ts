import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  const result = await docClient.send(
    new ScanCommand({
      TableName: env.eventsTableName,
      ProjectionExpression: "eventId, #n, venueName, #d, djBrandName, isActive, slug, isRecurring, accountMode",
      FilterExpression: "attribute_not_exists(accountMode) OR accountMode = :legacy",
      ExpressionAttributeNames: {
        "#n": "name",
        "#d": "date",
      },
      ExpressionAttributeValues: {
        ":legacy": "legacy",
      },
    }),
  );

  const events = (result.Items ?? [])
    .filter((item) => item.isActive !== false)
    .sort((a, b) => ((b.date as string) ?? "").localeCompare((a.date as string) ?? ""))
    .map(({ accountMode: _accountMode, ...legacyEvent }) => legacyEvent);

  return json(200, { events });
};
