import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireOrganizationRole, authorizationResponse } from "../shared/tenancy";
import { getStripe } from "../shared/stripe";
import type { OrganizationRecord } from "../shared/types";
import { docClient, env, json, parseBody } from "../shared/utils";

interface UpdateOrganizationInput {
  name?: string;
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
  };
  defaults?: {
    djBrandName?: string;
    venueName?: string;
  };
  requestDeletion?: boolean;
  cancelDeletion?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const organizationId = event.pathParameters?.organizationId;
    if (!organizationId) return json(400, { error: "organizationId is required" });
    const { membership } = await requireOrganizationRole(event, organizationId, ["owner", "admin"]);
    const input = parseBody<UpdateOrganizationInput>(event.body);
    if (!input) return json(400, { error: "A valid JSON request body is required" });
    const name = input?.name?.trim();
    if (!name && !input.branding && !input.defaults && !input.requestDeletion && !input.cancelDeletion) {
      return json(400, { error: "No supported organization update was provided" });
    }
    if ((input.requestDeletion || input.cancelDeletion) && membership.role !== "owner") {
      return json(403, { error: "Only the organization owner can change deletion status" });
    }

    const now = new Date();
    const setParts = ["updatedAt = :updatedAt"];
    const removeParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ":updatedAt": now.toISOString() };
    if (name) {
      names["#name"] = "name";
      setParts.push("#name = :name");
      values[":name"] = name;
    }
    if (input.branding) {
      const colors = [
        input.branding.primaryColor,
        input.branding.secondaryColor,
        input.branding.accentColor,
      ].filter((color): color is string => Boolean(color));
      if (colors.some((color) => !/^#[0-9a-fA-F]{6}$/.test(color))) {
        return json(400, { error: "Brand colors must use six-digit hex values" });
      }
      if (
        input.branding.logoUrl
        && !/^https:\/\/[^\s]+$/i.test(input.branding.logoUrl.trim())
      ) {
        return json(400, { error: "Brand logo must use a secure HTTPS URL" });
      }
      const branding = {
        primaryColor: input.branding.primaryColor ?? "#0f172a",
        secondaryColor: input.branding.secondaryColor ?? "#1e293b",
        accentColor: input.branding.accentColor ?? "#f97316",
        ...(input.branding.logoUrl?.trim() ? { logoUrl: input.branding.logoUrl.trim() } : {}),
      };
      setParts.push("branding = :branding");
      values[":branding"] = branding;
    }
    if (input.defaults) {
      setParts.push("defaults = :defaults");
      values[":defaults"] = {
        ...(input.defaults.djBrandName?.trim()
          ? { djBrandName: input.defaults.djBrandName.trim() }
          : {}),
        ...(input.defaults.venueName?.trim() ? { venueName: input.defaults.venueName.trim() } : {}),
      };
    }
    if (input.requestDeletion) {
      const scheduled = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      setParts.push(
        "accountStatus = :deletionPending",
        "deletionRequestedAt = :updatedAt",
        "deletionScheduledAt = :scheduled",
      );
      values[":deletionPending"] = "deletion_pending";
      values[":scheduled"] = scheduled;
    } else if (input.cancelDeletion) {
      setParts.push("accountStatus = :active");
      values[":active"] = "active";
      removeParts.push("deletionRequestedAt", "deletionScheduledAt");
    }

    const result = await docClient.send(
      new UpdateCommand({
        TableName: env.organizationsTableName,
        Key: { organizationId },
        ConditionExpression: "attribute_exists(organizationId)",
        UpdateExpression:
          `SET ${setParts.join(", ")}${removeParts.length ? ` REMOVE ${removeParts.join(", ")}` : ""}`,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    const organization = result.Attributes as OrganizationRecord | undefined;
    if (
      (input.requestDeletion || input.cancelDeletion)
      && organization?.stripeSubscriptionId
      && (process.env.STRIPE_SECRET_KEY_SSM_PARAM || env.stripeSecretKey)
    ) {
      const stripe = await getStripe();
      await stripe.subscriptions.update(organization.stripeSubscriptionId, {
        cancel_at_period_end: Boolean(input.requestDeletion),
      }).catch((error) => {
        console.warn("Could not update Stripe cancellation schedule", {
          organizationId,
          error: String(error),
        });
      });
    }
    return json(200, { organization: result.Attributes });
  } catch (error) {
    return authorizationResponse(error);
  }
};
