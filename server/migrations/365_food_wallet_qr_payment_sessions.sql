-- Migration 365: Short-lived QR payment sessions for restaurant credit.
-- QR codes never contain spendable value directly; they contain an opaque
-- token whose hash is stored here and redeemed atomically by POS.

CREATE TABLE IF NOT EXISTS food_wallet_payment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(96) NOT NULL UNIQUE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_account_id BIGINT REFERENCES food_customer_wallet_accounts(id) ON DELETE SET NULL,
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  amount_cents BIGINT CHECK (amount_cents IS NULL OR amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  redeemed_pos_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_wallet_payment_sessions_customer
  ON food_wallet_payment_sessions(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_wallet_payment_sessions_restaurant_status
  ON food_wallet_payment_sessions(restaurant_id, status, expires_at DESC);

