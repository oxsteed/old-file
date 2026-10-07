-- Migration 714: backfill restaurant_connect_accounts from the legacy
-- businesses.stripe_account_id.
--
-- P0 fix (dual Stripe Connect sources): restaurant_connect_accounts is now the
-- single source of truth for a restaurant's Connect account across checkout,
-- payouts, and top-ups. Rows created through the onboarding UI already exist;
-- this backfills restaurants whose account was only ever stored on the legacy
-- businesses.stripe_account_id column, so the rca-only reads keep working
-- after deploy.
--
-- Idempotency / safety:
--   * Skips restaurants that already have a restaurant_connect_accounts row
--     (never overwrites an onboarded row).
--   * Skips NULL / empty legacy values.
--   * If several restaurants share one legacy account, only the first
--     (lowest restaurant id) gets the row, because stripe_account_id is
--     UNIQUE on restaurant_connect_accounts. The others must onboard their
--     own per-restaurant account, per the per-restaurant identity rule.
--   * ON CONFLICT DO NOTHING makes re-runs safe.
--
-- The cached capability flags are copied from businesses so backfilled rows
-- behave exactly like the legacy reads did; the next status read in the
-- payouts surface re-verifies them against the Stripe API anyway.
--
-- The legacy businesses.stripe_account_id column is intentionally NOT dropped
-- here: business-level readers (business integrations, ops integrations,
-- account.updated webhook sync) still use it. Dropping it is a separate
-- coordinated step.

INSERT INTO restaurant_connect_accounts
  (restaurant_id, stripe_account_id, charges_enabled, payouts_enabled,
   onboarding_complete)
SELECT fr.id,
       b.stripe_account_id,
       COALESCE(b.stripe_charges_enabled, FALSE),
       COALESCE(b.stripe_payouts_enabled, FALSE),
       (COALESCE(b.stripe_charges_enabled, FALSE)
          OR COALESCE(b.stripe_payouts_enabled, FALSE)
          OR b.stripe_account_status = 'active')
  FROM food_restaurants fr
  JOIN businesses b ON b.id = fr.business_id
  LEFT JOIN restaurant_connect_accounts rca ON rca.restaurant_id = fr.id
 WHERE rca.restaurant_id IS NULL
   AND b.stripe_account_id IS NOT NULL
   AND b.stripe_account_id <> ''
   AND NOT EXISTS (
         SELECT 1
           FROM restaurant_connect_accounts r2
          WHERE r2.stripe_account_id = b.stripe_account_id
       )
   AND NOT EXISTS (
         -- one legacy account shared by several restaurants: only the lowest
         -- restaurant id claims it
         SELECT 1
           FROM food_restaurants fr2
           JOIN businesses b2 ON b2.id = fr2.business_id
          WHERE b2.stripe_account_id = b.stripe_account_id
            AND fr2.id < fr.id
       )
ON CONFLICT DO NOTHING;
