import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json } from "../shared/utils";

function paypalApiBase() {
  return env.paypalEnvironment === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getHeader(headers: Record<string, string | undefined> | undefined, key: string) {
  if (!headers) {
    return undefined;
  }
  const matchedKey = Object.keys(headers).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return matchedKey ? headers[matchedKey] : undefined;
}

async function getPaypalAccessToken() {
  if (!env.paypalClientId || !env.paypalClientSecret) {
    throw new Error("PayPal credentials not configured");
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

async function verifyWebhookSignature(
  accessToken: string,
  rawBody: string,
  headers: Record<string, string | undefined> | undefined,
) {
  if (!env.paypalWebhookId) {
    throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  }

  const transmissionId = getHeader(headers, "paypal-transmission-id");
  const transmissionTime = getHeader(headers, "paypal-transmission-time");
  const certUrl = getHeader(headers, "paypal-cert-url");
  const authAlgo = getHeader(headers, "paypal-auth-algo");
  const transmissionSig = getHeader(headers, "paypal-transmission-sig");

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    throw new Error("Missing PayPal transmission headers");
  }

  const webhookEvent = JSON.parse(rawBody) as unknown;
  const response = await fetch(`${paypalApiBase()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: env.paypalWebhookId,
      webhook_event: webhookEvent,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook signature verification failed: ${text || response.status}`);
  }

  const payload = (await response.json()) as { verification_status?: string };
  return payload.verification_status === "SUCCESS";
}

async function fetchOrderDetails(accessToken: string, orderId: string) {
  const response = await fetch(`${paypalApiBase()}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Unable to fetch PayPal order: ${text || response.status}`);
  }
  return (await response.json()) as {
    purchase_units?: Array<{
      custom_id?: string;
    }>;
  };
}

type PayPalWebhookEvent = {
  event_type?: string;
  resource?: {
    id?: string;
    amount?: { value?: string };
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event.body ?? "";
  if (!rawBody) {
    return json(400, { error: "Missing webhook body" });
  }

  try {
    const accessToken = await getPaypalAccessToken();
    const verified = await verifyWebhookSignature(accessToken, rawBody, event.headers);
    if (!verified) {
      return json(400, { error: "Invalid webhook signature" });
    }

    const webhookEvent = JSON.parse(rawBody) as PayPalWebhookEvent;
    const eventType = webhookEvent.event_type;

    if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
      return json(200, { received: true, ignored: true, eventType });
    }

    const captureId = webhookEvent.resource?.id;
    const orderId = webhookEvent.resource?.supplementary_data?.related_ids?.order_id;
    if (!captureId || !orderId) {
      return json(200, { received: true, ignored: true, reason: "Missing order or capture id" });
    }

    const order = await fetchOrderDetails(accessToken, orderId);
    const customId = order.purchase_units?.[0]?.custom_id ?? "";
    const [eventId, requestId] = customId.split(":");
    if (!eventId || !requestId) {
      return json(200, { received: true, ignored: true, reason: "Order not linked to request" });
    }

    const requestResult = await docClient.send(
      new GetCommand({
        TableName: env.requestsTableName,
        Key: { eventId, requestId },
      }),
    );
    const current = requestResult.Item as { paymentStatus?: string } | undefined;
    if (!current) {
      return json(200, { received: true, ignored: true, reason: "Request not found" });
    }
    if (current.paymentStatus === "verified") {
      return json(200, { received: true, alreadyVerified: true });
    }

    const paidAt = new Date().toISOString();
    const tipAmount = Number(webhookEvent.resource?.amount?.value ?? "0");
    await docClient.send(
      new UpdateCommand({
        TableName: env.requestsTableName,
        Key: { eventId, requestId },
        ConditionExpression: "attribute_exists(eventId) and attribute_exists(requestId)",
        UpdateExpression:
          "SET paymentStatus = :paymentStatus, paymentReference = :paymentReference, paymentVerifiedBy = :paymentVerifiedBy, paidAt = :paidAt, tipAmount = if_not_exists(tipAmount, :tipAmount)",
        ExpressionAttributeValues: {
          ":paymentStatus": "verified",
          ":paymentReference": captureId,
          ":paymentVerifiedBy": "paypal_webhook",
          ":paidAt": paidAt,
          ":tipAmount": tipAmount > 0 ? Number(tipAmount.toFixed(2)) : 0,
        },
      }),
    );

    return json(200, { received: true, processed: true, eventId, requestId, captureId });
  } catch (error) {
    return json(500, { error: `Webhook processing failed: ${(error as Error).message}` });
  }
};
