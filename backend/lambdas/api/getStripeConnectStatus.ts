import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getStripe } from "../shared/stripe";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import type { OrganizationRecord } from "../shared/types";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    if (!organizationId) return json(400, { error: "organizationId is required" });
    await requireOrganizationRole(event, organizationId);
    const result = await docClient.send(
      new GetCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
      }),
    );
    const organization = result.Item as OrganizationRecord | undefined;
    if (!organization) return json(404, { error: "Organization not found" });
    if (!organization.stripeConnectedAccountId) {
      return json(200, {
        connected: false,
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
    }

    const stripe = await getStripe();
    const account = await stripe.accounts.retrieve(organization.stripeConnectedAccountId);
    const now = new Date().toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
        UpdateExpression:
          "SET stripeConnectDetailsSubmitted = :details, stripeConnectChargesEnabled = :charges, "
          + "stripeConnectPayoutsEnabled = :payouts, updatedAt = :now",
        ExpressionAttributeValues: {
          ":details": account.details_submitted,
          ":charges": account.charges_enabled,
          ":payouts": account.payouts_enabled,
          ":now": now,
        },
      }),
    );
    return json(200, {
      connected: true,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      requirementsDue: account.requirements?.currently_due ?? [],
    });
  } catch (error) {
    return authorizationResponse(error);
  }
};
