import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import type { RequestRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface CreateRequestInput {
  songTitle: string;
  artistName: string;
  requesterName?: string;
  message?: string;
  tipAmount?: number;
  venmoHandle?: string;
  paymentReference?: string;
  paymentStatus?: "unpaid" | "pending_verification";
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const input = parseBody<CreateRequestInput>(event.body);
  if (!eventId || !input?.songTitle || !input?.artistName) {
    return json(400, { error: "eventId, songTitle and artistName are required" });
  }

  const requestRecord: RequestRecord = {
    eventId,
    requestId: randomUUID(),
    songTitle: input.songTitle,
    artistName: input.artistName,
    requesterName: input.requesterName,
    message: input.message,
    status: "pending",
    paymentStatus: input.paymentStatus ?? (input.tipAmount ? "pending_verification" : "unpaid"),
    tipAmount: typeof input.tipAmount === "number" ? Number(input.tipAmount.toFixed(2)) : undefined,
    venmoHandle: input.venmoHandle?.replace("@", ""),
    paymentReference: input.paymentReference,
    position: Date.now(),
    submittedAt: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: env.requestsTableName,
      Item: requestRecord,
    }),
  );

  return json(201, requestRecord);
};
