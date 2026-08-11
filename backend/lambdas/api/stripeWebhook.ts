import { DeleteCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type Stripe from "stripe";
import { entitlementsForPlan } from "../shared/plans";
import { getStripe, getStripeWebhookSecret } from "../shared/stripe";
import { docClient, env, json } from "../shared/utils";

export function subscriptionPlanForPrice(
  priceId: string | undefined,
  djPriceId = env.stripeDjPriceId,
  organizationPriceId = env.stripeOrganizationPriceId,
) {
  if (priceId && organizationPriceId && priceId === organizationPriceId) {
    return "organization" as const;
  }
  if (priceId && djPriceId && priceId === djPriceId) return "dj" as const;
  throw new Error(`Stripe subscription uses an unknown price ${priceId ?? "(missing)"}`);
}

async function updateSubscription(
  subscription: Stripe.Subscription,
  stripeEventCreatedAt: number,
): Promise<void> {
  const organizationId = subscription.metadata.organizationId;
  if (!organizationId) return;
  const subscriptionPriceId = subscription.items.data[0]?.price.id;
  const planId = subscriptionPlanForPrice(subscriptionPriceId);
  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : undefined;
  const gracePeriodEndsAt = subscription.status === "past_due"
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const accountStatus =
    subscription.status === "canceled" || subscription.status === "unpaid"
      ? "suspended"
      : "active";
  const values = {
    ":subscriptionId": subscription.id,
    ":status": subscription.status,
    ":trialEndsAt": trialEnd ?? null,
    ":gracePeriodEndsAt": gracePeriodEndsAt,
    ":accountStatus": accountStatus,
    ":deletionPending": "deletion_pending",
    ":planId": planId,
    ":entitlements": entitlementsForPlan(planId),
    ":eventCreated": stripeEventCreatedAt,
    ":now": new Date().toISOString(),
  };
  const baseSet =
    "stripeSubscriptionId = :subscriptionId, subscriptionStatus = :status, "
    + "trialEndsAt = :trialEndsAt, gracePeriodEndsAt = :gracePeriodEndsAt, "
    + "planId = :planId, entitlements = :entitlements, "
    + "stripeSubscriptionEventCreatedAt = :eventCreated, updatedAt = :now";
  const eventOrderCondition =
    "attribute_exists(organizationId) AND "
    + "(attribute_not_exists(stripeSubscriptionEventCreatedAt) "
    + "OR stripeSubscriptionEventCreatedAt <= :eventCreated)";
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
        UpdateExpression: `SET ${baseSet}, accountStatus = :accountStatus`,
        ConditionExpression:
          `${eventOrderCondition} AND `
          + "(attribute_not_exists(accountStatus) OR accountStatus <> :deletionPending) "
          + "AND attribute_not_exists(suspendedAt)",
        ExpressionAttributeValues: values,
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
    const {
      ":accountStatus": _accountStatus,
      ":deletionPending": _deletionPending,
      ...retryValues
    } = values;
    await docClient.send(
      new UpdateCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
        UpdateExpression: `SET ${baseSet}`,
        ConditionExpression: eventOrderCondition,
        ExpressionAttributeValues: retryValues,
      }),
    ).catch((retryError: { name?: string }) => {
      if (retryError.name !== "ConditionalCheckFailedException") throw retryError;
    });
  }
}

function eventOrganizationId(stripeEvent: Stripe.Event): string | undefined {
  const object = stripeEvent.data.object as { metadata?: Record<string, string> };
  return object.metadata?.organizationId;
}

async function markTipPaid(session: Stripe.Checkout.Session): Promise<void> {
  const { organizationId, eventId, requestId, paymentAttemptId } = session.metadata ?? {};
  if (
    !organizationId
    || !eventId
    || !requestId
    || !paymentAttemptId
    || session.payment_status !== "paid"
  ) return;
  const paidAt = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId },
      ConditionExpression:
        "organizationId = :organizationId AND attribute_exists(requestId) "
        + "AND stripePaymentAttemptId = :attemptId",
      UpdateExpression:
        "SET paymentStatus = :verified, paymentReference = :reference, tipAmount = :tipAmount, "
        + "paidAt = :paidAt, paymentVerifiedBy = :verifiedBy",
      ExpressionAttributeValues: {
        ":organizationId": organizationId,
        ":attemptId": paymentAttemptId,
        ":verified": "verified",
        ":reference": String(session.payment_intent ?? session.id),
        ":tipAmount": Number(((session.amount_total ?? 0) / 100).toFixed(2)),
        ":paidAt": paidAt,
        ":verifiedBy": "stripe:webhook",
      },
    }),
  ).catch((error: { name?: string }) => {
    if (error.name !== "ConditionalCheckFailedException") throw error;
  });
}

async function markTipRejected(
  metadata: Stripe.Metadata | null | undefined,
  paymentReference: string,
  reason: "failed" | "refunded",
): Promise<void> {
  const { organizationId, eventId, requestId, paymentAttemptId } = metadata ?? {};
  if (!organizationId || !eventId || !requestId || !paymentAttemptId) return;
  await docClient.send(
    new UpdateCommand({
      TableName: env.requestsTableName,
      Key: { eventId, requestId },
      ConditionExpression:
        "organizationId = :organizationId AND attribute_exists(requestId) "
        + "AND stripePaymentAttemptId = :attemptId",
      UpdateExpression:
        "SET paymentStatus = :rejected, paymentReference = :reference, "
        + "paymentFailureReason = :reason, paymentUpdatedAt = :now",
      ExpressionAttributeValues: {
        ":organizationId": organizationId,
        ":attemptId": paymentAttemptId,
        ":rejected": "rejected",
        ":reference": paymentReference,
        ":reason": reason,
        ":now": new Date().toISOString(),
      },
    }),
  ).catch((error: { name?: string }) => {
    if (error.name !== "ConditionalCheckFailedException") throw error;
  });
}

async function updateConnectedAccount(
  account: Stripe.Account,
  stripeEventCreatedAt: number,
): Promise<void> {
  const organizationId = account.metadata?.organizationId;
  if (!organizationId) return;
  await docClient.send(
    new UpdateCommand({
      TableName: env.organizationsTableName,
      Key: { organizationId },
      UpdateExpression:
        "SET stripeConnectDetailsSubmitted = :details, stripeConnectChargesEnabled = :charges, "
        + "stripeConnectPayoutsEnabled = :payouts, "
        + "stripeConnectEventCreatedAt = :eventCreated, updatedAt = :now",
      ConditionExpression:
        "attribute_exists(organizationId) AND "
        + "(attribute_not_exists(stripeConnectEventCreatedAt) "
        + "OR stripeConnectEventCreatedAt <= :eventCreated)",
      ExpressionAttributeValues: {
        ":details": account.details_submitted,
        ":charges": account.charges_enabled,
        ":payouts": account.payouts_enabled,
        ":eventCreated": stripeEventCreatedAt,
        ":now": new Date().toISOString(),
      },
    }),
  ).catch((error: { name?: string }) => {
    if (error.name !== "ConditionalCheckFailedException") throw error;
  });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const webhookSecret = await getStripeWebhookSecret();
  if (!webhookSecret) return json(503, { error: "Stripe webhook is not configured" });
  const signature = event.headers?.["stripe-signature"] ?? event.headers?.["Stripe-Signature"];
  if (!signature || !event.body) return json(400, { error: "Missing Stripe signature or body" });
  const payload = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  let stripeEvent: Stripe.Event;
  try {
    const stripe = await getStripe();
    stripeEvent = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    return json(400, { error: `Invalid Stripe webhook: ${(error as Error).message}` });
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: env.billingEventsTableName,
        Item: {
          eventId: stripeEvent.id,
          eventType: stripeEvent.type,
          organizationId: eventOrganizationId(stripeEvent),
          status: "processing",
          connectedAccountId: stripeEvent.account,
          expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(eventId)",
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
      return json(200, { received: true, duplicate: true });
    }
    throw error;
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;
      if (session.metadata?.purpose === "song-request-tip") {
        await markTipPaid(session);
      } else if (session.metadata?.purpose === "organization-subscription" && session.subscription) {
        const stripe = await getStripe();
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
        await updateSubscription(subscription, stripeEvent.created);
      }
    } else if (
      stripeEvent.type === "customer.subscription.created"
      || stripeEvent.type === "customer.subscription.updated"
      || stripeEvent.type === "customer.subscription.deleted"
    ) {
      await updateSubscription(
        stripeEvent.data.object as Stripe.Subscription,
        stripeEvent.created,
      );
    } else if (stripeEvent.type === "account.updated") {
      await updateConnectedAccount(
        stripeEvent.data.object as Stripe.Account,
        stripeEvent.created,
      );
    } else if (stripeEvent.type === "payment_intent.payment_failed") {
      const paymentIntent = stripeEvent.data.object as Stripe.PaymentIntent;
      await markTipRejected(paymentIntent.metadata, paymentIntent.id, "failed");
    } else if (stripeEvent.type === "charge.refunded") {
      const charge = stripeEvent.data.object as Stripe.Charge;
      await markTipRejected(charge.metadata, charge.id, "refunded");
    } else if (stripeEvent.type === "checkout.session.async_payment_failed") {
      const session = stripeEvent.data.object as Stripe.Checkout.Session;
      await markTipRejected(session.metadata, session.id, "failed");
    }

    await docClient.send(
      new UpdateCommand({
        TableName: env.billingEventsTableName,
        Key: { eventId: stripeEvent.id },
        UpdateExpression: "SET #status = :completed, completedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":completed": "completed",
          ":now": new Date().toISOString(),
        },
      }),
    );
    return json(200, { received: true });
  } catch (error) {
    await docClient.send(
      new DeleteCommand({
        TableName: env.billingEventsTableName,
        Key: { eventId: stripeEvent.id },
      }),
    ).catch(() => undefined);
    console.error("stripeWebhook: processing failed", {
      eventId: stripeEvent.id,
      eventType: stripeEvent.type,
      error: String(error),
    });
    throw error;
  }
};

export const stripeWebhookTestExports = {
  updateSubscription,
};
