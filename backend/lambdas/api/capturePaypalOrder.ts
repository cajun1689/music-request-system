import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json, parseBody } from "../shared/utils";

interface CapturePaypalOrderInput {
  orderId: string;
}

function paypalApiBase() {
  return env.paypalEnvironment === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPaypalAccessToken() {
  if (!env.paypalClientId || !env.paypalClientSecret) {
    throw new Error("PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  }
  const auth = Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64");
  const response = await fetch(`${paypalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayPal auth failed: ${text || response.status}`);
  }
  const tokenData = (await response.json()) as { access_token: string };
  return tokenData.access_token;
}

type PaypalCaptureResponse = {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    custom_id?: string;
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { value?: string };
      }>;
    };
  }>;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const requestId = event.pathParameters?.requestId;
  if (!eventId || !requestId) {
    return json(400, { error: "eventId and requestId are required" });
  }

  const body = parseBody<CapturePaypalOrderInput>(event.body);
  const orderId = body?.orderId ?? event.queryStringParameters?.token;
  if (!orderId) {
    return json(400, { error: "orderId is required" });
  }

  const requestResult = await docClient.send(
    new GetCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId },
    }),
  );
  const requestRecord = requestResult.Item as
    | { eventId: string; requestId: string; paymentStatus?: string; tipAmount?: number }
    | undefined;
  if (!requestRecord) {
    return json(404, { error: "Request not found" });
  }
  if (requestRecord.paymentStatus === "verified") {
    return json(200, { verified: true, alreadyPaid: true, request: requestRecord });
  }

  try {
    const accessToken = await getPaypalAccessToken();
    const captureResponse = await fetch(`${paypalApiBase()}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    let payload: PaypalCaptureResponse;
    if (captureResponse.ok) {
      payload = (await captureResponse.json()) as PaypalCaptureResponse;
    } else {
      // If already captured, get order details and continue verification from there.
      const detailsResponse = await fetch(`${paypalApiBase()}/v2/checkout/orders/${orderId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!detailsResponse.ok) {
        const text = await captureResponse.text();
        return json(502, { error: text || "Unable to capture PayPal order" });
      }
      payload = (await detailsResponse.json()) as PaypalCaptureResponse;
    }

    const firstUnit = payload.purchase_units?.[0];
    const customId = firstUnit?.custom_id ?? "";
    if (customId !== `${eventId}:${requestId}`) {
      return json(400, { error: "PayPal order does not match this request" });
    }

    const capture = firstUnit?.payments?.captures?.find((item) => item.status === "COMPLETED");
    if (!capture?.id) {
      return json(400, { error: "PayPal payment not completed yet" });
    }

    const expectedAmount = typeof requestRecord.tipAmount === "number" ? requestRecord.tipAmount : 0;
    const paidAmount = Number(capture.amount?.value ?? "0");
    if (expectedAmount > 0 && paidAmount < expectedAmount) {
      return json(400, { error: "Captured amount is less than requested tip amount" });
    }

    const now = new Date().toISOString();
    const updated = await docClient.send(
      new UpdateCommand({
        TableName: env.requestsTableName,
        Key: { eventId, requestId },
        ConditionExpression: "attribute_exists(eventId) and attribute_exists(requestId)",
        UpdateExpression:
          "SET paymentStatus = :paymentStatus, paymentReference = :paymentReference, paidAt = :paidAt, paymentVerifiedBy = :paymentVerifiedBy",
        ExpressionAttributeValues: {
          ":paymentStatus": "verified",
          ":paymentReference": capture.id,
          ":paidAt": now,
          ":paymentVerifiedBy": "paypal_automated",
        },
        ReturnValues: "ALL_NEW",
      }),
    );

    return json(200, {
      verified: true,
      orderId,
      captureId: capture.id,
      request: updated.Attributes,
    });
  } catch (error) {
    return json(500, {
      error: `Failed to capture PayPal order: ${(error as Error).message}`,
    });
  }
};
