-- Migration 656: per-restaurant Stripe Connect accounts (merchant payouts).
--
-- Restaurants take orders through OxSteed but previously had no way to get
-- paid out. This adds one Stripe Express account per restaurant, mirroring
-- the helper flow (connect_accounts, migration 014), which is keyed per
-- user and must stay untouched.
--
-- A dedicated table (rather than a restaurant_id column on
-- connect_accounts) is intentional:
--   * connect_accounts.user_id is UNIQUE NOT NULL; a restaurant account has
--     no single user identity (the owner can change).
--   * A business can own several restaurants, and each restaurant keeps its
--     own payouts identity, per Emile's rule that each business keeps its
--     own identity.
--
-- Onboarding state is cached on the row and refreshed from the Stripe API on
-- every status read (see restaurantPayoutController). The account itself is
-- the source of truth; the row is never trusted blindly.

CREATE TABLE IF NOT EXISTS restaurant_connect_accounts (
  id                 BIGSERIAL PRIMARY KEY,
  restaurant_id      BIGINT NOT NULL UNIQUE REFERENCES food_restaurants (id) ON DELETE CASCADE,
  stripe_account_id  VARCHAR(255) NOT NULL UNIQUE,
  charges_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_connect_accounts_stripe
  ON restaurant_connect_accounts (stripe_account_id);
