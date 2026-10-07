# Stripe Connect: business vs restaurant vs helper sources of truth

## Business (Standard OAuth) vs `restaurant_connect_accounts`

| Surface | Source of truth |
|--------|------------------|
| Business Hub OAuth, business invoices (card pay) | `businesses.stripe_account_id` + `stripe_*_enabled` flags |
| Food checkout, payouts, restaurant top-ups | `restaurant_connect_accounts` per `food_restaurants` row |

**Invoice card pay (business issuer):** `resolveBusinessInvoiceConnect` in `server/services/stripeConnectSoTService.js` prefers `businesses.stripe_*`. `restaurant_connect_accounts` is used only when the business row has no OAuth account (typical food-only onboarding).

**Divergence:** If both stores hold different Stripe account ids for the same business, invoice card pay and sync helpers **fail closed** with `stripe_connect_accounts_mismatch`. Fix in Business Hub (disconnect/reconnect) or align food merchant Connect — do not silently pick one.

**Backfill:** After OAuth callback or `account.updated` webhook, `syncBusinessOAuthToRestaurantConnect` idempotently inserts missing RCA rows from `businesses.stripe_*` (same rules as migration `714`). It updates capability flags on RCA rows that already share the same account id. It does not replace a restaurant’s distinct onboarded account.

## Helper (Express) vs `helper_profiles.stripe_*`

| Source of truth | `connect_accounts` (Express, `/api/payments/connect`) |
| Legacy mirror | `helper_profiles.stripe_*` (synced on refresh/webhook) |

Auth and job payments read `connect_accounts` (see `middleware/auth.js`). Admin views that still select `helper_profiles.stripe_*` receive values synced from `connect_accounts` via `syncHelperProfileStripeFromConnect`.

**No auto-creation:** Live Stripe accounts are created only when the user starts Connect (`POST /payments/connect` or business OAuth). Invoice card pay stays disabled until `charges_enabled` is true on the resolved account.

## Live onboarding (Emile / merchants)

Finish Stripe Dashboard requirements until `charges_enabled` is true:

- **Business:** Hub → Connect Stripe, or **Open Stripe to finish requirements** (`POST …/integrations/stripe/continue-setup` → login link).
- **Helper:** Issued invoices banner or QR pay → **Connect** / **Continue in Stripe** (Account Link flow).
