import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getStripe } from "../shared/stripe";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import type { OrganizationRecord, SaasPlanId } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface BillingCheckoutInput {
  planId?: SaasPlanId;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    if (!organizationId) return json(400, { error: "organizationId is required" });
    const { caller } = await requireOrganizationRole(event, organizationId, ["owner"]);
    const result = await docClient.send(
      new GetCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
      }),
    );
    const organization = result.Item as OrganizationRecord | undefined;
    if (!organization) return json(404, { error: "Organization not found" });
    if (
      organization.stripeSubscriptionId
      && organization.subscriptionStatus
      && ["active", "trialing", "past_due"].includes(organization.subscriptionStatus)
    ) {
      return json(409, { error: "Use Manage billing to change an existing subscription" });
    }
    const input = parseBody<BillingCheckoutInput>(event.body);
    const planId: SaasPlanId = input?.planId === "organization"
      ? "organization"
      : input?.planId === "dj"
        ? "dj"
        : organization.planId === "organization"
          ? "organization"
          : "dj";
    const priceId = planId === "organization"
      ? env.stripeOrganizationPriceId
      : env.stripeDjPriceId;
    if (!priceId) {
      return json(503, {
        error: `${planId === "organization" ? "Organization" : "DJ"} subscription pricing is not configured`,
      });
    }

    const stripe = await getStripe();
    const configuredPrice = await stripe.prices.retrieve(priceId);
    const expectedAmount = planId === "organization" ? 10_000 : 2_500;
    if (
      !configuredPrice.active
      || configuredPrice.currency !== "usd"
      || configuredPrice.unit_amount !== expectedAmount
      || configuredPrice.recurring?.interval !== "month"
    ) {
      return json(503, {
        error: `The configured ${planId} price must be $${expectedAmount / 100}/month`,
      });
    }
    let customerId = organization.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          name: organization.name,
          email: caller.email || undefined,
          metadata: { organizationId },
        },
        { idempotencyKey: `organization-customer-${organizationId}` },
      );
      customerId = customer.id;
      await docClient.send(
        new UpdateCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId },
          UpdateExpression: "SET stripeCustomerId = :customerId, updatedAt = :now",
          ExpressionAttributeValues: {
            ":customerId": customerId,
            ":now": new Date().toISOString(),
          },
        }),
      );
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${env.appBaseUrl}/console?organizationId=${organizationId}&billing=success`,
        cancel_url: `${env.appBaseUrl}/console?organizationId=${organizationId}&billing=cancel`,
        subscription_data: {
          ...(organization.trialEndsAt ? {} : { trial_period_days: 14 }),
          metadata: { organizationId, planId },
        },
        metadata: { organizationId, planId, purpose: "organization-subscription" },
      },
      {
        idempotencyKey:
          `billing-checkout-${organizationId}-${planId}-`
          + `${organization.stripeSubscriptionId ?? "initial"}-${organization.subscriptionStatus}`,
      },
    );
    return json(200, { url: session.url });
  } catch (error) {
    return authorizationResponse(error);
  }
};
