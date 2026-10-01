# Stripe production setup - 2026-09-30

## Verified current state

- OxSteed live Stripe account: `acct_1TB0hBGo54BMlgSy`.
- The active platform webhook `we_1TI0MBGo54BMlgSyb0eBydfp` at
  `https://oxsteed.com/api/webhooks/stripe` now listens to the contract's 22
  events, snapshot version `2026-02-25.clover`. Saved after explicit approval
  and verified active in Stripe. No signed live delivery has yet been verified.
- The 12-event Connected accounts destination `we_1ULXPkGo54BMlgSypMqXTeTr`
  and 2-event Identity destination `we_1ULXR1Go54BMlgSyty3kL7zw` are saved
  and active, also using snapshot version `2026-02-25.clover`. Their distinct
  signing secrets still require direct entry into Coolify and live acceptance.
- Business OAuth is enabled in the live Stripe dashboard. Its saved default
  redirect is `https://oxsteed.com/api/businesses/integrations/stripe/callback`.
  No business was connected automatically and no owner consent was supplied.
- Existing Pro recurring prices match the production plans exactly:
  monthly USD 14.99 (`price_1THyAiGo54BMlgSyPzPoIOk6`) and yearly USD 79.99
  (`price_1THyCDGo54BMlgSyzrRM6Swt`). Migration 615 replaces only the known
  placeholders when the amount, currency and interval match. No new price is created.
- Production has zero connected helper payout accounts. Individual recipients
  must complete Stripe onboarding; platform setup cannot supply their consent,
  identity verification or bank details.
- Basic is a zero-cost plan, not a paid Stripe product. The old Broker price
  returned "Price not found". With explicit approval, live product
  `prod_VMG57RImt3RZiM` and USD 39/month recurring price
  `price_1ULXZLGo54BMlgSyEbdvgz2f` were saved. Migration 616 replaces only
  that known missing price at unchanged amount, currency and billing interval.
  Custom contracts and historical payments are not rewritten.
- Last verified production image `fd24d1a211471680acdbc079199d3df51010bd4f` is deployed and
  healthy. `/ready` reports 615/615 migrations, no pending migrations, healthy
  database, Redis, realtime and workers. Release metadata identifiers still
  require their deploy-time environment configuration.

## Changes in this release

- Accept `invoice.paid` and legacy `invoice.payment_succeeded`; normalize modern
  invoice parent references and item-level subscription billing periods.
- Retry renewal reconciliation when Stripe retrieval fails.
- Separate Connect signature verification at `/api/webhooks/stripe/connect`.
  Reject account-source mismatches and fail closed if its secret is missing.
- Correct connected-account readiness updates to bind all five SQL parameters
  and match both the Stripe account and its stored user owner.
- Repair refund audit and ledger writes using existing authoritative services/schema.
- Verify current cumulative refund evidence instead of double-counting refunds
  when a webhook arrives before request settlement. Partial refunds retain the
  payment's captured state; delayed lower totals cannot reduce refunded amounts.
- Record dispute closure through the existing fraud-case path.
- Keep regional Premium overrides separate from Pro yearly and Broker contracts.
- Business OAuth now has one registered callback for all businesses, signed
  state, a browser-bound HttpOnly cookie, expiry validation, single-use atomic
  consumption and current-owner checks before both exchange and persistence.
  Integration and business readiness are saved transactionally. Deprecated
  OAuth access/refresh tokens are not persisted. Legacy callback URLs retain
  the same validation. Test-mode connections are rejected in production.
- Helper Express creation uses provider idempotency and conflict-safe local
  persistence. Onboarding resumes for missing capabilities or outstanding
  requirements; unverified cached status is not presented as current readiness.
  Redirects use trusted application configuration, not request headers.
- Business webhook synchronization covers every mapped business in a transaction,
  binds every SQL parameter, preserves deliberately disabled integrations and
  propagates write failures for retry instead of silently acknowledging them.
- Business disconnect authenticates Stripe revocation, leaves local evidence
  intact on provider failure and clears both local records transactionally.
  Revoking shared account access requires support review rather than silently
  breaking another business's payment connection.

## Destination contract

The source of truth is `server/config/stripeWebhookContract.js`. Subscribe to its
bounded event lists, not all events.

| Destination | Events from | Signing-secret variable |
| --- | --- | --- |
| `/api/webhooks/stripe` | Your account | `STRIPE_WEBHOOK_SECRET` |
| `/api/webhooks/stripe/connect` | Connected accounts | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `/api/verification/webhooks/identity` | Your account, Identity events only | `STRIPE_IDENTITY_WEBHOOK_SECRET` |

Never reuse a signing secret between destinations. Enter new secrets directly
into Coolify, not a public repository, browser storage or chat. Do not replace
the working platform signing secret when adding the other destinations.

### Remaining environment setup

Only presence booleans were checked; no secret values were printed or copied.
The live platform secret is present. The following are still absent:

| Variable | Impact / next step |
| --- | --- |
| `STRIPE_PUBLISHABLE_KEY` | Marketplace/mobile card payment setup needs the live account's public key in runtime configuration |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Enter the saved 12-event Connect destination's distinct signing secret directly into Coolify |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | Enter the saved 2-event Identity destination's distinct signing secret directly into Coolify |
| `STRIPE_CLIENT_ID` | Enter the visible live Connect client ID from the enabled OAuth settings; the callback is already saved |

`STRIPE_CLIENT_SECRET` is only an optional legacy override. The repaired OAuth
exchange uses the existing `STRIPE_SECRET_KEY` by default, as required by Stripe;
no additional private OAuth client secret needs to be created.

Do not add empty values and claim completion. Restart/deploy after saving real
configuration, verify presence without revealing values, and verify actual
signed event acceptance. Helper Express onboarding is separate from business
OAuth: a missing business client ID does not disable every Connect flow.
Startup diagnostics now report the names used by the actual controllers rather
than the unused `STRIPE_CONNECT_CLIENT_ID` alias.

## Site coverage and remaining live acceptance

| Area | Required setup / acceptance |
| --- | --- |
| Pro subscriptions and QR Pro access | Migration 615, subscription/renewal/cancellation events, checkout and billing portal acceptance |
| Helper job payments and payouts | Connect destination, recipient onboarding, capability readiness, manual capture and refund acceptance |
| Business Stripe connections | Existing business OAuth configuration and exact callback allowlist, owner consent and verified connected account |
| Food online orders / POS | Existing payment settings, payment/refund events; Terminal requires actual registered location/reader and in-person testing |
| Marketplace checkout | Existing server-owned pricing plus succeeded/failed/refund acceptance |
| Simple delivery and extras | Checkout, async/expiration, payment and refund events; retain customer approval and existing ledger |
| Consulting / mobile booking payments | Existing verified confirmation endpoints; browser-close recovery must be tested, not inferred from webhook availability |
| Direct, rentals and business invoices | Retain each domain's existing payment/receipt flow; a guide or payment button alone does not establish a Stripe integration |
| Restaurant Credit and OxSteed Credit | Preserve their separate authoritative ledgers and launch approvals; do not activate Treasury/Issuing or add a Stripe lending product |
| Identity | Dedicated destination and signing secret, existing verification rules and actual live acceptance |

Live webhook delivery, connected-account onboarding, Terminal hardware, legal/tax
settings and real-money acceptance are not certified by unit tests or Stripe's
setup-guide checkmarks. Do not enable payment methods, taxes, payout schedules,
charges or new financial products merely to make setup appear complete.

## Verification

Client `npm run build:ci` passed, including translation checks, typecheck and 692
verified emitted assets. The final full server run passed 280 suites / 2665 tests
with the optional PGlite delivery fixture skipped (37 tests). Refund SQL and audit
schema checks ran against isolated PostgreSQL 15 containers with no production
network access. Migrations 615 and 616 were separately rehearsed for repeatability
and custom-mapping preservation. Actual concurrent OAuth consumption, expiry,
revoked ownership and granted-owner authorization were checked in PostgreSQL.
The focused six-suite Stripe run passed 91 tests. No production data was used
in these fixtures. This change does not modify frontend code.

After deploying this change, verify migration 616, container health, readiness, actual revision,
the public plans response and each destination's delivery result. Do not mark
Connect/Identity complete until their secrets are installed and a signed event is
accepted. No real charges, refunds, transfers or subscriptions were initiated during setup.
