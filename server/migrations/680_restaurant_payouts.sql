-- Migration 680: restaurant wallet-earnings payouts.
--
-- Card payments settle directly to the restaurant's Stripe Connect account
-- (destination charges), so OxSteed never holds them. But wallet/credit
-- payments accumulate as OxSteed's liability in restaurant_sub_bank
-- (restaurant_id, currency). This table tracks payout requests that move
-- those balances out to the restaurant's Connect account via Stripe Transfer.
--
-- Lifecycle: requested -> approved -> processing -> completed
--                        requested -> rejected
--                        approved/processing -> failed (Stripe or ledger error)
-- A payout is only ever executed once: the ledger posting and the Stripe
-- transfer share the payout's idempotency key, and the row is locked
-- (FOR UPDATE) during execution.

CREATE TABLE IF NOT EXISTS restaurant_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled')),
  stripe_transfer_id VARCHAR(255),
  stripe_account_id VARCHAR(255) NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  ledger_transaction_id BIGINT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_restaurant_payouts_idempotency UNIQUE (restaurant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_payouts_restaurant
  ON restaurant_payouts (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_payouts_status
  ON restaurant_payouts (status, created_at ASC)
  WHERE status IN ('requested', 'approved', 'processing');
