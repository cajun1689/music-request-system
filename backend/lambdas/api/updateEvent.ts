import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json, parseBody } from "../shared/utils";

interface UpdateEventInput {
  name?: string;
  slug?: string;
  isRecurring?: boolean;
  date?: string;
  venueName?: string;
  djBrandName?: string;
  venueLogoUrl?: string;
  djLogoUrl?: string;
  seratoLiveUrl?: string;
  rekordboxLiveUrl?: string;
  venmoHandle?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  isActive?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  if (!eventId) {
    return json(400, { error: "eventId is required" });
  }

  const input = parseBody<UpdateEventInput>(event.body);
  if (!input) {
    return json(400, { error: "Invalid JSON body" });
  }
  if (typeof input.venmoHandle === "string") {
    input.venmoHandle = input.venmoHandle.replace("@", "");
  }

  const fieldEntries = Object.entries(input).filter(([, value]) => value !== undefined);
  if (fieldEntries.length === 0) {
    return json(400, { error: "No fields to update" });
  }

  const expressionParts: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {
    ":updatedAt": new Date().toISOString(),
  };

  fieldEntries.forEach(([key, value], index) => {
    const fieldName = `#f${index}`;
    const fieldValue = `:v${index}`;
    expressionParts.push(`${fieldName} = ${fieldValue}`);
    expressionNames[fieldName] = key;
    expressionValues[fieldValue] = value;
  });

  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.eventsTableName,
      Key: { eventId },
      ConditionExpression: "attribute_exists(eventId)",
      UpdateExpression: `SET ${expressionParts.join(", ")}, updatedAt = :updatedAt`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
