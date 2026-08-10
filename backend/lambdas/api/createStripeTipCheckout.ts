import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { getStripe } from "../shared/stripe";
import { organizationAllowsUsage } from "../shared/plans";
import type { EventRecord, OrganizationRecord, RequestRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface StripeTipInput {
  tipAmount: number;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const eventId = event.pathParameters?.eventId;
  const requestId = event.pathParameters?.requestId;
  const input = parseBody<StripeTipInput>(event.body);
  const tipAmount = Number(input?.tipAmount ?? 0);
  if (!eventId || !requestId) return json(400, { error: "eventId and requestId are required" });
  if (!Number.isFinite(tipAmount) || tipAmount < 1 || tipAmount > 500) {
    return json(400, { error: "Tip amount must be between $1 and $500" });
  }

  const [eventResult, requestResult] = await Promise.all([
    docClient.send(new GetCommand({ TableName: env.eventsTableName, Key: { eventId } })),
    docClient.send(new GetCommand({ TableName: env.requestsTableName, Key: { eventId, requestId } })),
  ]);
  const eventRecord = eventResult.Item as EventRecord | undefined;
  const requestRecord = requestResult.Item as RequestRecord | undefined;
  if (!eventRecord || eventRecord.accountMode !== "saas" || !eventRecord.organizationId) {
    return json(409, { error: "Stripe tips are available for SaaS events only" });
  }
  if (!requestRecord) return json(404, { error: "Request not found" });
  if (requestRecord.organizationId !== eventRecord.organizationId) {
    return json(409, { error: "Request tenant does not match the event" });
  }
  if (requestRecord.paymentStatus === "verified") return json(200, { alreadyPaid: true });
  if (
    !["pending_verification", "rejected"].includes(requestRecord.paymentStatus ?? "")
    || Math.round(Number(requestRecord.tipAmount ?? 0) * 100) !== Math.round(tipAmount * 100)
  ) {
    return json(409, { error: "Tip amount does not match the submitted request" });
  }

  const organizationResult = await docClient.send(
    new GetCommand({
      TableName: env.organizationsTableName,
      Key: { organizationId: eventRecord.organizationId },
    }),
  );
  const organization = organizationResult.Item as OrganizationRecord | undefined;
  if (
    !organization?.stripeConnectedAccountId
    || !organizationAllowsUsage(organization)
    || !organization.stripeConnectChargesEnabled
    || !organization.stripeConnectPayoutsEnabled
  ) {
    return json(409, { error: "This DJ has not finished setting up Stripe payouts" });
  }

  const amountCents = Math.round(tipAmount * 100);
  const stripe = await getStripe();
  const metadata = {
    organizationId: organization.organizationId,
    eventId,
    requestId,
    paymentAttemptId: randomUUID(),
    purpose: "song-request-tip",
  };
  if (
    requestRecord.paymentStatus === "pending_verification"
    && requestRecord.paymentReference?.startsWith("cs_")
  ) {
    const existingSession = await stripe.checkout.sessions.retrieve(
      requestRecord.paymentReference,
      {},
      { stripeAccount: organization.stripeConnectedAccountId },
    ).catch(() => null);
    if (existingSession?.status === "open" && existingSession.url) {
      return json(200, { checkoutUrl: existingSession.url });
    }
    if (existingSession?.payment_status === "paid") {
      return json(200, { alreadyPaid: true });
    }
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Song request tip — ${requestRecord.songTitle}`,
              description: `${requestRecord.artistName} · ${eventRecord.djBrandName}`.slice(0, 250),
            },
          },
        },
      ],
      payment_intent_data: { metadata },
      metadata,
      success_url:
        `${env.appBaseUrl}/event/${eventId}?stripe=success&requestId=${encodeURIComponent(requestId)}`,
      cancel_url:
        `${env.appBaseUrl}/event/${eventId}?stripe=cancel&requestId=${encodeURIComponent(requestId)}`,
    },
    {
      stripeAccount: organization.stripeConnectedAccountId,
      idempotencyKey:
        `tip-checkout-${eventId}-${requestId}-${amountCents}-${requestRecord.paymentReference ?? "initial"}`,
    },
  );

  await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId },
      UpdateExpression:
        "SET paymentStatus = :pending, paymentReference = :reference, tipAmount = :tipAmount, "
        + "stripePaymentAttemptId = :attemptId",
      ExpressionAttributeValues: {
        ":pending": "pending_verification",
        ":reference": session.id,
        ":tipAmount": tipAmount,
        ":attemptId": session.metadata?.paymentAttemptId ?? metadata.paymentAttemptId,
      },
    }),
  );
  return json(200, { checkoutUrl: session.url });
};
