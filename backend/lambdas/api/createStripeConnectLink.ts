import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getStripe } from "../shared/stripe";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import { organizationAllowsUsage } from "../shared/plans";
import type { OrganizationRecord } from "../shared/types";
import { docClient, env, json } from "../shared/utils";

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
    if (!organizationAllowsUsage(organization)) {
      return json(402, { error: "Activate an organization subscription before setting up payouts" });
    }

    const stripe = await getStripe();
    let connectedAccountId = organization.stripeConnectedAccountId;
    if (!connectedAccountId) {
      const connectedAccount = await stripe.accounts.create({
        type: "express",
        email: caller.email || undefined,
        business_profile: {
          name: organization.name,
          product_description: "DJ song request tips",
          url: env.appBaseUrl,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { organizationId },
      });
      connectedAccountId = connectedAccount.id;
      await docClient.send(
        new UpdateCommand({
          TableName: env.organizationsTableName,
          Key: { organizationId },
          UpdateExpression:
            "SET stripeConnectedAccountId = :accountId, "
            + "stripeConnectDetailsSubmitted = :false, stripeConnectChargesEnabled = :false, "
            + "stripeConnectPayoutsEnabled = :false, updatedAt = :now",
          ExpressionAttributeValues: {
            ":accountId": connectedAccountId,
            ":false": false,
            ":now": new Date().toISOString(),
          },
        }),
      );
    }

    const accountLink = await stripe.accountLinks.create({
      account: connectedAccountId,
      type: "account_onboarding",
      refresh_url: `${env.appBaseUrl}/console?organizationId=${organizationId}&connect=refresh`,
      return_url: `${env.appBaseUrl}/console?organizationId=${organizationId}&connect=return`,
    });
    return json(200, { url: accountLink.url });
  } catch (error) {
    return authorizationResponse(error);
  }
};
