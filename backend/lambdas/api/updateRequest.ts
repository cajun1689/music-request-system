import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { EventRecord, PaymentStatus, RequestStatus } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";
import { requireEventAccess, authorizationResponse } from "../shared/tenancy";

const REVIEWABLE_STATUS: RequestStatus[] = ["approved", "vetoed", "played"];
const VALID_PAYMENT_STATUSES: PaymentStatus[] = [
  "unpaid",
  "pending_verification",
  "verified",
  "rejected",
];

interface UpdateRequestInput {
  status?: RequestStatus;
  position?: number;
  paymentStatus?: PaymentStatus;
  paymentReference?: string;
  tipAmount?: number;
  reviewedBy?: string;
  shoutoutApproved?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const requestId = event.pathParameters?.requestId;
  if (!eventId || !requestId) {
    return json(400, { error: "eventId and requestId are required" });
  }
  let eventRecord: EventRecord;
  try {
    ({ eventRecord } = await requireEventAccess(event, eventId, ["owner", "admin", "dj"]));
  } catch (error) {
    return authorizationResponse(error);
  }

  const input = parseBody<UpdateRequestInput>(event.body);
  if (
    !input ||
    (input.status === undefined &&
      input.position === undefined &&
      input.paymentStatus === undefined &&
      input.paymentReference === undefined &&
      input.tipAmount === undefined &&
      input.shoutoutApproved === undefined)
  ) {
    return json(400, { error: "At least one updatable field is required" });
  }

  if (input.status && !REVIEWABLE_STATUS.includes(input.status)) {
    return json(400, { error: "status must be approved, vetoed, or played" });
  }
  if (input.paymentStatus && !VALID_PAYMENT_STATUSES.includes(input.paymentStatus)) {
    return json(400, { error: "Invalid paymentStatus value" });
  }
  if (
    eventRecord.accountMode === "saas"
    && (
      input.paymentStatus !== undefined
      || input.paymentReference !== undefined
      || input.tipAmount !== undefined
    )
  ) {
    return json(403, { error: "Stripe payment fields are updated only by verified webhooks" });
  }

  const now = new Date().toISOString();
  const expressionParts: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {};

  if (input.status) {
    expressionNames["#status"] = "status";
    expressionParts.push("#status = :status", "reviewedAt = :reviewedAt");
    expressionValues[":status"] = input.status;
    expressionValues[":reviewedAt"] = now;
  }

  if (input.reviewedBy) {
    expressionParts.push("reviewedBy = :reviewedBy");
    expressionValues[":reviewedBy"] = input.reviewedBy;
  }

  if (typeof input.position === "number") {
    expressionParts.push("position = :position");
    expressionValues[":position"] = input.position;
  }
  if (input.paymentStatus) {
    expressionParts.push("paymentStatus = :paymentStatus");
    expressionValues[":paymentStatus"] = input.paymentStatus;
    if (input.paymentStatus === "verified") {
      expressionParts.push("paidAt = :paidAt");
      expressionValues[":paidAt"] = now;
      if (input.reviewedBy) {
        expressionParts.push("paymentVerifiedBy = :paymentVerifiedBy");
        expressionValues[":paymentVerifiedBy"] = input.reviewedBy;
      }
    }
  }
  if (typeof input.tipAmount === "number") {
    expressionParts.push("tipAmount = :tipAmount");
    expressionValues[":tipAmount"] = Number(input.tipAmount.toFixed(2));
  }
  if (typeof input.paymentReference === "string") {
    expressionParts.push("paymentReference = :paymentReference");
    expressionValues[":paymentReference"] = input.paymentReference;
  }

  if (input.status === "played") {
    expressionParts.push("playedAt = :playedAt");
    expressionValues[":playedAt"] = now;
  }
  if (typeof input.shoutoutApproved === "boolean") {
    expressionParts.push("shoutoutApproved = :shoutoutApproved");
    expressionValues[":shoutoutApproved"] = input.shoutoutApproved;
    if (input.shoutoutApproved) {
      expressionParts.push("shoutoutApprovedAt = :shoutoutApprovedAt");
      expressionValues[":shoutoutApprovedAt"] = now;
    }
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId },
      ConditionExpression: "attribute_exists(eventId) and attribute_exists(requestId)",
      UpdateExpression: `SET ${expressionParts.join(", ")}`,
      ExpressionAttributeNames: Object.keys(expressionNames).length ? expressionNames : undefined,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: "ALL_NEW",
    }),
  );

  return json(200, result.Attributes);
};
