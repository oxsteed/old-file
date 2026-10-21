-- Migration 982: restaurant gift-card value and append-only ledger.
-- Raw card codes are never stored. The issue response is the only time a
-- generated code is returned; redemption accepts the code and hashes it.

CREATE TABLE IF NOT EXISTS restaurant_gift_cards (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES restaurant_gift_card_products(id) ON DELETE RESTRICT,
  code_hash CHAR(64) NOT NULL,
  code_last4 CHAR(4) NOT NULL,
  delivery_type VARCHAR(16) NOT NULL CHECK (delivery_type IN ('physical', 'e_gift')),
  currency_code CHAR(3) NOT NULL,
  initial_balance_cents INTEGER NOT NULL CHECK (initial_balance_cents > 0),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'depleted', 'blocked', 'expired')),
  issued_to_customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_gift_cards_lookup
  ON restaurant_gift_cards (restaurant_id, code_last4, status, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_gift_card_ledger (
  id BIGSERIAL PRIMARY KEY,
  gift_card_id BIGINT NOT NULL REFERENCES restaurant_gift_cards(id) ON DELETE RESTRICT,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  event_type VARCHAR(16) NOT NULL
    CHECK (event_type IN ('issue', 'redeem', 'refund', 'void', 'adjust')),
  delta_cents INTEGER NOT NULL,
  balance_before_cents INTEGER NOT NULL CHECK (balance_before_cents >= 0),
  balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gift_card_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_gift_card_ledger_card
  ON restaurant_gift_card_ledger (gift_card_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION restaurant_gift_card_value_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_gift_card_value_updated_at
  ON restaurant_gift_cards;
CREATE TRIGGER restaurant_gift_card_value_updated_at
  BEFORE UPDATE ON restaurant_gift_cards
  FOR EACH ROW EXECUTE FUNCTION restaurant_gift_card_value_updated_at();
