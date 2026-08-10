# Casper Requests SaaS operations

## Required GitHub secrets

Production:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_DJ_PRICE_ID` — recurring $25/month Solo DJ price
- `STRIPE_ORGANIZATION_PRICE_ID` — recurring $100/month Club / DJ Organization price
- `SENTRY_DSN` — production browser project DSN
- `ALARM_EMAIL` — production CloudWatch alarm recipient

Staging:

- `STRIPE_TEST_SECRET_KEY`
- `STRIPE_TEST_WEBHOOK_SECRET`
- `STRIPE_TEST_DJ_PRICE_ID`
- `STRIPE_TEST_ORGANIZATION_PRICE_ID`
- `PAYPAL_SANDBOX_CLIENT_ID` and `PAYPAL_SANDBOX_CLIENT_SECRET` if legacy payment regression testing is required
- `SENTRY_STAGING_DSN` (optional)

The workflows copy Stripe secret values into encrypted stage-specific SSM parameters before deployment. Lambda configuration contains only parameter names. The deployment role therefore needs `ssm:PutParameter`, while CDK grants the runtime functions read-only access to the exact parameters.

Configure the Stripe webhook URL as:

`https://<api-host>/prod/payments/stripe-webhook`

Subscribe it to platform and connected-account events:

- `checkout.session.completed`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `payment_intent.payment_failed`
- `charge.refunded`
- `account.updated`

Both subscription Checkout prices must be recurring monthly prices. The Solo DJ plan is $25/month for one member; the Club / DJ Organization plan is $100/month and enables team/device limits for a multi-DJ operation. Connected organizations use direct charges with no application fee.

## Staging

Run the **Deploy SaaS Staging** workflow manually. It creates `InfrastructureStackStaging` with separate DynamoDB tables, Cognito pool, API, WebSocket API, buckets, CloudFront distribution, alarms, and test-mode Stripe configuration.

Never put live Stripe credentials in the staging secrets. The staging CloudFront URL is available in the workflow’s CloudFormation outputs.

## Legacy compatibility migration

The production workflow invokes `MigrateLegacyTenantFn` immediately after the tenant tables deploy and before publishing the self-signup frontend. The migration is idempotent and adds:

- the internal `mapl-legacy` organization,
- organization memberships for the Cognito users that existed at the first successful migration,
- `organizationId: "mapl-legacy"`, and
- `accountMode: "legacy"`

to existing records when those fields are absent. The membership import is marked complete so later SaaS signups can never gain MAPL access on a subsequent deploy. It does not replace event IDs, slugs, push tokens, payments, source IDs, requests, or Bridge configuration. Public legacy DTOs deliberately omit the migration-only fields.

## Pilot launch checklist

1. Run backend type checks, infrastructure tests, frontend build/lint, Bridge build/tests, and `cdk synth`.
2. Deploy staging and complete signup, email verification, password reset, organization creation, subscription Checkout, Connect onboarding, first event, and Bridge pairing.
3. Submit free and paid requests; verify that a direct Stripe tip lands in the connected test account with no application fee.
4. Test failed, refunded, and duplicate webhook delivery.
5. Confirm Org A receives `403` when using known Org B IDs for events, requests, members, devices, assets, and analytics.
6. Run the full existing MAPL login, Admin, Dashboard, request, PayPal, Venmo, overlay, analytics, Bridge push, and auto-play flows.
7. Pair and revoke at least two test Bridge devices independently.
8. Confirm alarms, WAF sampled requests, Sentry organization tags, DynamoDB point-in-time recovery, S3 versions, and the async failure queue.
9. Pilot with 2–3 outside DJ organizations before enabling public marketing links.

## Suspension and deletion

Stripe `past_due` subscriptions receive a seven-day grace period. Canceled or unpaid subscriptions are suspended server-side from new events, devices, and tips. Existing MAPL records are exempt.

Organization owners can request deletion in the console. Data enters a 30-day deletion-pending state, the subscription is set to cancel at period end, and both can be restored during that window. The daily cleanup job then cancels remaining Stripe resources on a best-effort basis and removes tenant events, requests, memberships, invitations, devices, usage counters, connections, and all versions of tenant brand/library objects. Stripe webhook idempotency records expire after 90 days. Owners can download an authenticated JSON export before deletion.

## Incident response

- Check the SNS alarm topic and Sentry first.
- Inspect the Stripe event ID in `BillingEvents`; duplicate webhook delivery is expected and idempotent.
- Inspect the async failure queue for scheduled or request-stream failures.
- Revoke a single Bridge device instead of rotating organization-wide credentials.
- Do not run the legacy migration with a different organization ID.
