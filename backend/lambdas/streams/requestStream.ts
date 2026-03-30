import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBStreamHandler } from "aws-lambda";
import { docClient, env } from "../shared/utils";

type ConnectionRecord = {
  connectionId: string;
  eventId: string;
  role: "dj" | "overlay" | "guest";
};

const apigwClient = new ApiGatewayManagementApiClient({
  endpoint: `https://${env.websocketEndpoint}`,
});

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (!record.dynamodb?.NewImage && !record.dynamodb?.OldImage) {
      continue;
    }

    const newImage = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : undefined;
    const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : undefined;
    const eventId = String(newImage?.eventId ?? oldImage?.eventId ?? "");
    if (!eventId) {
      continue;
    }

    const connections = await docClient.send(
      new QueryCommand({
        TableName: env.connectionsTableName,
        IndexName: "eventId-index",
        KeyConditionExpression: "eventId = :eventId",
        ExpressionAttributeValues: {
          ":eventId": eventId,
        },
      }),
    );

    const payload = JSON.stringify({
      type: "request_updated",
      action: record.eventName,
      eventId,
      data: newImage ?? oldImage,
    });

    await Promise.all(
      (connections.Items as ConnectionRecord[] | undefined)?.map(async (connection) => {
        try {
          await apigwClient.send(
            new PostToConnectionCommand({
              ConnectionId: connection.connectionId,
              Data: Buffer.from(payload),
            }),
          );
        } catch (error) {
          const name = (error as Error).name;
          if (name === "GoneException") {
            await docClient.send(
              new DeleteCommand({
                TableName: env.connectionsTableName,
                Key: {
                  connectionId: connection.connectionId,
                },
              }),
            );
          }
        }
      }) ?? [],
    );
  }
};
