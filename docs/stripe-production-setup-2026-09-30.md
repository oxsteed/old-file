# Stripe production setup - 2026-09-30

## Verified current state

- OxSteed live Stripe account: `acct_1TB0hBGo54BMlgSy`.
- One active platform webhook: `https://oxsteed.com/api/webhooks/stripe`,
  snapshot version `2026-02-25.clover`. Initially subscribed to five events;
  the expanded event selection is prepared but must not be called live until saved.
- Existing Pro recurring prices match the production plans exactly:
  monthly USD 14.99 (`price_1THyAiGo54BMlgSyPzPoIOk6`) and yearly USD 79.99
  (`price_1THyCDGo54BMlgSyzrRM6Swt`). Migration 615 replaces only the known
  placeholders when the amount, currency and interval match. No new price is created.
- Production has zero connected helper payout accounts. Individual recipients
  must complete Stripe onboarding; platform setup cannot supply their consent,
  identity verification or bank details.
- Basic is a zero-cost plan, not a paid Stripe product. Broker's configured price
  still requires verification; no replacement or price change is assumed.

## Changes in this release

- Accept `invoice.paid` and legacy `invoice.payment_succeeded`; normalize modern
  invoice parent references and item-level subscription billing periods.
- Retry renewal reconciliation when Stripe retrieval fails.
- Separate Connect signature verification at `/api/webhooks/stripe/connect`.
  Reject account-source mismatches and fail closed if its secret is missing.
- Repair refund audit and ledger writes using existing authoritative services/schema.
- Verify current cumulative refund evidence instead of double-counting refunds
  when a webhook arrives before request settlement. Partial refunds retain the
  payment's captured state; delayed lower totals cannot reduce refunded amounts.
- Record dispute closure through the existing fraud-case path.
- Keep regional Premium overrides separate from Pro yearly and Broker contracts.

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
verified emitted assets. The final full server run passed 279 suites / 2632 tests
with the optional PGlite delivery fixture skipped (37 tests). Refund SQL and audit
schema checks ran against an isolated PostgreSQL 15 container with no production
network access. Migration 615 is separately rehearsed there for repeatability and
custom-mapping preservation. No production data was used in these fixtures.

After deploying, verify migration 615, container health, readiness, actual revision,
the public plans response and each destination's delivery result. Do not mark
Connect/Identity complete until their secrets are installed and a signed event is
accepted. No real charges, refunds, transfers or subscriptions were initiated during setup.
