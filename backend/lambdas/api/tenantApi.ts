import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { handler as acceptOrganizationInvitation } from "./acceptOrganizationInvitation";
import { handler as createBillingCheckout } from "./createBillingCheckout";
import { handler as createBillingPortal } from "./createBillingPortal";
import { handler as createBridgePairingCode } from "./createBridgePairingCode";
import { handler as createOrganization } from "./createOrganization";
import { handler as createOrganizationInvitation } from "./createOrganizationInvitation";
import { handler as createStripeConnectLink } from "./createStripeConnectLink";
import { handler as getAdminEvent } from "./getAdminEvent";
import { handler as getAdminRequests } from "./getAdminRequests";
import { handler as getOrganization } from "./getOrganization";
import { handler as getStripeConnectStatus } from "./getStripeConnectStatus";
import { handler as listBridgeDevices } from "./listBridgeDevices";
import { handler as listMyOrganizations } from "./listMyOrganizations";
import { handler as listOrganizationEvents } from "./listOrganizationEvents";
import { handler as listOrganizationMembers } from "./listOrganizationMembers";
import { handler as revokeBridgeDevice } from "./revokeBridgeDevice";
import { handler as updateOrganization } from "./updateOrganization";
import { handler as updateOrganizationMember } from "./updateOrganizationMember";
import { json } from "../shared/utils";

type LambdaHandler = (...args: Parameters<APIGatewayProxyHandlerV2>) => unknown;

const routes: Record<string, LambdaHandler> = {
  "GET /admin/events/{eventId}": getAdminEvent as LambdaHandler,
  "GET /admin/events/{eventId}/requests": getAdminRequests as LambdaHandler,
  "GET /me/organizations": listMyOrganizations as LambdaHandler,
  "POST /organizations": createOrganization as LambdaHandler,
  "GET /organizations/{organizationId}": getOrganization as LambdaHandler,
  "PATCH /organizations/{organizationId}": updateOrganization as LambdaHandler,
  "GET /organizations/{organizationId}/members": listOrganizationMembers as LambdaHandler,
  "PATCH /organizations/{organizationId}/members/{userId}": updateOrganizationMember as LambdaHandler,
  "DELETE /organizations/{organizationId}/members/{userId}": updateOrganizationMember as LambdaHandler,
  "POST /organizations/{organizationId}/invitations": createOrganizationInvitation as LambdaHandler,
  "GET /organizations/{organizationId}/events": listOrganizationEvents as LambdaHandler,
  "POST /organizations/{organizationId}/billing/checkout": createBillingCheckout as LambdaHandler,
  "POST /organizations/{organizationId}/billing/portal": createBillingPortal as LambdaHandler,
  "POST /organizations/{organizationId}/stripe/connect": createStripeConnectLink as LambdaHandler,
  "GET /organizations/{organizationId}/stripe/status": getStripeConnectStatus as LambdaHandler,
  "GET /organizations/{organizationId}/devices": listBridgeDevices as LambdaHandler,
  "DELETE /organizations/{organizationId}/devices/{deviceId}": revokeBridgeDevice as LambdaHandler,
  "POST /invitations/{token}/accept": acceptOrganizationInvitation as LambdaHandler,
  "POST /bridge/pairing-codes": createBridgePairingCode as LambdaHandler,
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  const restEvent = event as typeof event & { resource?: string; httpMethod?: string };
  const method = restEvent.httpMethod ?? event.requestContext.http?.method ?? "";
  const resource = restEvent.resource ?? event.rawPath;
  const route = routes[`${method} ${resource}`];
  if (!route) return json(404, { error: "Tenant API route not found" });
  const response = await route(event, context, callback);
  return (response ?? json(500, { error: "Tenant API returned no response" })) as never;
};
