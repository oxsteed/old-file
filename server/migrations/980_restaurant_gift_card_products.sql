-- Migration 980: physical and e-gift card product catalog.
-- This is catalog metadata only. It does not issue value, redeem a card, or
-- write a payment/ledger row; those money paths require a later provider and
-- reconciliation implementation.
CREATE TABLE IF NOT EXISTS restaurant_gift_card_products (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  delivery_type VARCHAR(16) NOT NULL CHECK (delivery_type IN ('physical', 'e_gift')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_gift_card_products_active
  ON restaurant_gift_card_products(restaurant_id, is_active, delivery_type, id);

CREATE OR REPLACE FUNCTION restaurant_gift_card_products_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_gift_card_products_updated_at
  ON restaurant_gift_card_products;
CREATE TRIGGER restaurant_gift_card_products_updated_at
  BEFORE UPDATE ON restaurant_gift_card_products
  FOR EACH ROW EXECUTE FUNCTION restaurant_gift_card_products_updated_at();
