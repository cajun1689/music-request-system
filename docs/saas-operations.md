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

The workflows also set the non-secret `STRIPE_ENABLED` deployment flag only when both secrets and both recurring price IDs are present. For a manual CDK deployment, set `STRIPE_ENABLED=true` only after those SSM parameters and price IDs are configured; otherwise keep it false so billing controls fail closed. A scheduled organization purge pauses instead of orphaning known Stripe resources while this integration is unavailable.

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

Organization owners can request deletion in the console. Data enters a 30-day deletion-pending state, the subscription is set to cancel at period end, and both can be restored during that window. The daily cleanup job must remove or confirm the prior removal of known Stripe resources before it purges local data; other Stripe failures abort that attempt for automatic retry. It then removes tenant events, requests, memberships, invitations, devices, usage counters, billing-event payloads, support sessions, connections, and all versions of tenant brand/library objects. Security audit records are retained without customer credentials so platform actions remain attributable. Stripe webhook idempotency records otherwise expire after 90 days. Owners can download an authenticated JSON export before deletion.

## Platform administration

The cross-tenant operations dashboard is available at `/platform-admin`. Access is limited server-side to owner or admin members of the internal `mapl-legacy` organization. This intentionally includes the Cognito users imported by the one-time legacy migration; later SaaS signups are never added to that organization.

Platform operators can inspect organization health, members, invitations, events, devices, usage, verified-tip analytics, billing state, and recent audit history. The structured JSON export includes tenant records, usage and billing history, platform-operation records, and a versioned S3 object manifest for brand assets and library snapshots; binary objects are inventoried rather than embedded in the JSON. Mutating actions require a reason and must first persist an immutable audit intent; completion or failure is appended afterward, leaving a visible pending operation if execution is interrupted. High-impact controls add typed confirmation and protect the current operator, the final organization owner, and the platform access boundary.

Customer support mode never reveals or replaces a customer's Cognito credentials. It creates a revocable, operator-bound session for at most 60 minutes, defaults to read-only, remains visibly identified in the browser, and records start, access, mutation, and end events. Session authorization expires independently from its 400-day history retention. Elevated support-write sessions are restricted to that organization and only allow invitation, member, and Bridge-device operations; account status, billing, deletion, and global Cognito actions require leaving support mode and using the normal platform controls. End the session immediately when the support case is complete.

Manual suspension is independent of Stripe billing. Plan, trial, cancellation, and reactivation controls use Stripe as the source of truth and remain unavailable until the stage's Stripe secrets and price IDs are configured. Deletion always enters the existing 30-day recovery window; the dashboard does not expose an immediate purge button.

## Incident response

- Check the SNS alarm topic and Sentry first.
- Inspect the Stripe event ID in `BillingEvents`; duplicate webhook delivery is expected and idempotent.
- Inspect the async failure queue for scheduled or request-stream failures.
- Revoke a single Bridge device instead of rotating organization-wide credentials.
- Do not run the legacy migration with a different organization ID.
