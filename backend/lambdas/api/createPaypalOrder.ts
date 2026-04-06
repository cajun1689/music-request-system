import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { docClient, env, json, parseBody } from "../shared/utils";

interface CreatePaypalOrderInput {
  tipAmount: number;
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

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const requestId = event.pathParameters?.requestId;
  if (!eventId || !requestId) {
    return json(400, { error: "eventId and requestId are required" });
  }

  const input = parseBody<CreatePaypalOrderInput>(event.body);
  const tipAmount = Number(input?.tipAmount ?? 0);
  if (!Number.isFinite(tipAmount) || tipAmount <= 0) {
    return json(400, { error: "tipAmount must be greater than zero" });
  }

  const requestResult = await docClient.send(
    new GetCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId },
    }),
  );
  const requestRecord = requestResult.Item as
    | { eventId: string; requestId: string; songTitle: string; artistName: string; paymentStatus?: string }
    | undefined;
  if (!requestRecord) {
    return json(404, { error: "Request not found" });
  }
  if (requestRecord.paymentStatus === "verified") {
    return json(200, { alreadyPaid: true });
  }

  const origin = event.headers?.origin;
  if (!origin) {
    return json(400, { error: "Missing origin header" });
  }
  const returnUrl = `${origin}/event/${eventId}?paypal=return&requestId=${encodeURIComponent(requestId)}`;
  const cancelUrl = `${origin}/event/${eventId}?paypal=cancel&requestId=${encodeURIComponent(requestId)}`;

  try {
    const accessToken = await getPaypalAccessToken();
    const createOrderResponse = await fetch(`${paypalApiBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `${eventId}-${requestId}-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: requestId,
            custom_id: `${eventId}:${requestId}`,
            amount: {
              currency_code: "USD",
              value: tipAmount.toFixed(2),
            },
            description: `Song request tip: ${requestRecord.songTitle} - ${requestRecord.artistName}`.slice(
              0,
              127,
            ),
          },
        ],
        application_context: {
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      }),
    });
    if (!createOrderResponse.ok) {
      const text = await createOrderResponse.text();
      return json(502, { error: text || "Unable to create PayPal order" });
    }

    const payload = (await createOrderResponse.json()) as {
      id: string;
      links?: Array<{ rel: string; href: string }>;
    };
    const approveUrl = payload.links?.find((link) => link.rel === "approve")?.href;
    if (!payload.id || !approveUrl) {
      return json(502, { error: "PayPal order response missing approval link" });
    }

    return json(200, {
      orderId: payload.id,
      approveUrl,
      environment: env.paypalEnvironment,
    });
  } catch (error) {
    return json(500, {
      error: `Failed to create PayPal order: ${(error as Error).message}`,
    });
  }
};
