-- Migration 861: Phase 4 restaurant credit pre-purchase reserve.
--
-- "Gift card inventory" model: a restaurant pre-purchases OxSteed Credit into
-- a reserve BEFORE it may issue restaurant credit to customers. Issuance is
-- capped at the reserve balance, so the money sits with OxSteed before any
-- customer is exposed and the enforcement problem disappears.
--
-- Money-safety contract (fail closed):
--  - restaurant_credit_reserves is credited ONLY after Stripe confirms the
--    PaymentIntent succeeded (confirm path re-reads the intent from Stripe
--    and requires status 'succeeded' with matching amount/currency).
--  - Issuance draws the reserve down atomically inside the SAME database
--    transaction as the customer wallet credit: the reserve row is locked
--    FOR UPDATE, a 409 insufficient_credit_reserve aborts the whole
--    transaction, and every drawdown writes an append-only ledger row.
--  - Opt-in per restaurant: restaurants WITHOUT a reserve row are NOT
--    capped by this phase (they continue under the trial-tier cap, which
--    Phase 5 owns). A reserve row is created the first time a purchase is
--    confirmed, which is what opts the restaurant into enforcement.
--
-- restaurant_credit_reserve_purchases is the durable record of each reserve
-- purchase attempt: 'pending' while the card payment is in flight,
-- 'succeeded' once Stripe confirms and the reserve is credited, 'failed' or
-- 'canceled' when the payment cannot complete. The row is created BEFORE the
-- Stripe PaymentIntent so a retried request replays the same purchase
-- (UNIQUE (restaurant_id, idempotency_key)) instead of charging twice.

CREATE TABLE IF NOT EXISTS restaurant_credit_reserves (
  restaurant_id BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  lifetime_purchased_cents BIGINT NOT NULL DEFAULT 0,
  lifetime_issued_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_credit_reserve_ledger (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  -- Positive = reserve purchase (money in), negative = issuance drawdown
  -- (credit issued to a customer) or reversal.
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL CHECK (balance_after_cents >= 0),
  reference_type VARCHAR(50) NOT NULL
    CHECK (reference_type IN ('purchase', 'issuance', 'refund_reversal', 'admin_adjustment')),
  reference_id VARCHAR(120),
  stripe_payment_intent_id VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_credit_reserve_ledger_restaurant_created
  ON restaurant_credit_reserve_ledger (restaurant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS restaurant_credit_reserve_purchases (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  -- 2.5% platform fee taken at purchase time; the reserve is credited with
  -- issuable_cents = amount_cents - fee_cents.
  fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0),
  issuable_cents BIGINT NOT NULL CHECK (issuable_cents > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  stripe_payment_intent_id VARCHAR(120),
  idempotency_key VARCHAR(120) NOT NULL,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_credit_reserve_purchases_pi
  ON restaurant_credit_reserve_purchases (stripe_payment_intent_id);
