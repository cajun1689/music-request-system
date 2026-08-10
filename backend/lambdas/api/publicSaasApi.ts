import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { handler as createStripeTipCheckout } from "./createStripeTipCheckout";
import { handler as pairBridgeDevice } from "./pairBridgeDevice";
import { handler as refreshBridgeDevice } from "./refreshBridgeDevice";
import { handler as stripeWebhook } from "./stripeWebhook";
import { handler as unpairBridgeDevice } from "./unpairBridgeDevice";
import { json } from "../shared/utils";

type LambdaHandler = (...args: Parameters<APIGatewayProxyHandlerV2>) => unknown;

const routes: Record<string, LambdaHandler> = {
  "POST /bridge/pair": pairBridgeDevice as LambdaHandler,
  "POST /bridge/refresh": refreshBridgeDevice as LambdaHandler,
  "POST /bridge/unpair": unpairBridgeDevice as LambdaHandler,
  "POST /events/{eventId}/requests/{requestId}/payments/stripe-checkout":
    createStripeTipCheckout as LambdaHandler,
  "POST /payments/stripe-webhook": stripeWebhook as LambdaHandler,
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  const restEvent = event as typeof event & { resource?: string; httpMethod?: string };
  const method = restEvent.httpMethod ?? event.requestContext.http?.method ?? "";
  const resource = restEvent.resource ?? event.rawPath;
  const route = routes[`${method} ${resource}`];
  if (!route) return json(404, { error: "Public SaaS API route not found" });
  const response = await route(event, context, callback);
  return (response ?? json(500, { error: "Public SaaS API returned no response" })) as never;
};
