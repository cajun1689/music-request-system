import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getStripe } from "../shared/stripe";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import type { OrganizationRecord } from "../shared/types";
import { docClient, env, json } from "../shared/utils";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    if (!organizationId) return json(400, { error: "organizationId is required" });
    await requireOrganizationRole(event, organizationId, ["owner"]);
    const result = await docClient.send(
      new GetCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
      }),
    );
    const organization = result.Item as OrganizationRecord | undefined;
    if (!organization?.stripeCustomerId) {
      return json(409, { error: "Start a subscription before opening the billing portal" });
    }
    const stripe = await getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: `${env.appBaseUrl}/console?organizationId=${organizationId}`,
    });
    return json(200, { url: session.url });
  } catch (error) {
    return authorizationResponse(error);
  }
};
