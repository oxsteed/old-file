-- Migration 858: restaurant-initiated food credit refunds (Phase 2).
--
-- A refund deducts credit from the customer's food wallet at a restaurant and
-- pushes the money back to the customer over Stripe. The row is the durable
-- record of the attempt: 'pending' while the money moves, 'processed' once
-- Stripe confirms, 'failed' when the Stripe leg cannot complete (the wallet
-- deduction is rolled back in that case, so a 'failed' row never moved money).
--
-- The wallet row lives in food_customer_wallet_accounts (migration 346);
-- wallet_id references that table.

CREATE TABLE IF NOT EXISTS food_credit_refunds (
  id BIGSERIAL PRIMARY KEY,
  wallet_id BIGINT NOT NULL REFERENCES food_customer_wallet_accounts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed')),
  stripe_refund_id VARCHAR(120),
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  reason VARCHAR(500),
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_food_credit_refunds_restaurant_status
  ON food_credit_refunds(restaurant_id, status);

CREATE INDEX IF NOT EXISTS idx_food_credit_refunds_customer_created
  ON food_credit_refunds(customer_id, created_at DESC);
