-- Migration 318: Operating hours, brand accent, promotions, loyalty ledger, verified badge.

ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS brand_accent_hex VARCHAR(7),
  ADD COLUMN IF NOT EXISTS operating_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS food_restaurant_promotions (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description TEXT,
  discount_percent NUMERIC(5, 2),
  discount_cents INTEGER,
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  valid_from DATE,
  valid_until DATE,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_food_restaurant_promotions_active
  ON food_restaurant_promotions(restaurant_id, is_active, valid_from, valid_until);

CREATE TABLE IF NOT EXISTS food_loyalty_accounts (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points_balance INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_food_loyalty_accounts_customer
  ON food_loyalty_accounts(customer_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS food_loyalty_ledger (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES food_loyalty_accounts(id) ON DELETE CASCADE,
  order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  delta_points INTEGER NOT NULL,
  reason VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_loyalty_ledger_account
  ON food_loyalty_ledger(account_id, created_at DESC);
