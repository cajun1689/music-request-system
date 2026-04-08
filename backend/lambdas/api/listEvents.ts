import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  const result = await docClient.send(
    new ScanCommand({
      TableName: env.eventsTableName,
      ProjectionExpression: "eventId, #n, venueName, #d, djBrandName, isActive, slug, isRecurring",
      ExpressionAttributeNames: {
        "#n": "name",
        "#d": "date",
      },
    }),
  );

  const events = (result.Items ?? [])
    .filter((item) => item.isActive !== false)
    .sort((a, b) => ((b.date as string) ?? "").localeCompare((a.date as string) ?? ""));

  return json(200, { events });
};
