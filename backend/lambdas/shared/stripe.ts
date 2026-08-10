import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import Stripe from "stripe";
import { env } from "./utils";

let stripeClient: Stripe | null = null;
let cachedSecretKey: string | null = null;
let cachedWebhookSecret: string | null = null;
let secretKeyFetchedAt = 0;
let webhookSecretFetchedAt = 0;
const ssm = new SSMClient({});
const CACHE_TTL_MS = 5 * 60 * 1000;

async function secureValue(
  parameterName: string | undefined,
  fallback: string,
): Promise<string> {
  if (!parameterName) return fallback;
  const result = await ssm.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );
  return result.Parameter?.Value ?? "";
}

export async function getStripe(): Promise<Stripe> {
  if (!cachedSecretKey || Date.now() - secretKeyFetchedAt > CACHE_TTL_MS) {
    const nextKey = await secureValue(
      process.env.STRIPE_SECRET_KEY_SSM_PARAM,
      env.stripeSecretKey,
    );
    if (nextKey !== cachedSecretKey) stripeClient = null;
    cachedSecretKey = nextKey;
    secretKeyFetchedAt = Date.now();
  }
  if (!cachedSecretKey) {
    throw new Error("Stripe is not configured");
  }
  stripeClient ??= new Stripe(cachedSecretKey, {
    appInfo: {
      name: "Casper Requests",
      version: "1.0.0",
    },
  });
  return stripeClient;
}

export async function getStripeWebhookSecret(): Promise<string> {
  if (!cachedWebhookSecret || Date.now() - webhookSecretFetchedAt > CACHE_TTL_MS) {
    cachedWebhookSecret = await secureValue(
      process.env.STRIPE_WEBHOOK_SECRET_SSM_PARAM,
      env.stripeWebhookSecret,
    );
    webhookSecretFetchedAt = Date.now();
  }
  return cachedWebhookSecret;
}
