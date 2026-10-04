-- Migration 676: checkout fields for scheduled orders and card payments.
--
-- Part A: food_orders gains nullable checkout-support columns so the
-- order-create payload can carry kitchen-facing notes, a pickup contact, and
-- a scheduled fulfillment time. All columns are nullable so existing rows and
-- order flows are unaffected.
--
-- Part B: food_card_payment_intents records every Stripe PaymentIntent minted
-- by POST /api/food/card-payment/intent, keyed by the client-supplied
-- idempotency key per restaurant. Key reuse returns the original intent's
-- client secret instead of authorizing a second charge.

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS kitchen_notes TEXT,
  ADD COLUMN IF NOT EXISTS pickup_contact_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pickup_contact_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS food_card_payment_intents (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  stripe_payment_intent_id VARCHAR(255) NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_food_card_payment_intents_restaurant_key
    UNIQUE (restaurant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_food_card_payment_intents_pi
  ON food_card_payment_intents(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_food_card_payment_intents_restaurant
  ON food_card_payment_intents(restaurant_id, created_at DESC);
