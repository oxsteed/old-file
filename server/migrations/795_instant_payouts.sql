-- Migration 795: local ledger for instant payouts (review P3-1-F16).
-- requestInstantPayout creates a row BEFORE calling Stripe so a Stripe-side
-- failure is tracked locally instead of vanishing, and payout.* webhook
-- events reconcile the row as Stripe settles the payout asynchronously.
CREATE TABLE IF NOT EXISTS instant_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(255) NOT NULL,
  stripe_payout_id VARCHAR(255),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  status VARCHAR(32) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'pending', 'in_transit', 'paid', 'failed', 'canceled')),
  failure_message TEXT,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instant_payouts_user ON instant_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_instant_payouts_stripe_payout ON instant_payouts(stripe_payout_id);
CREATE INDEX IF NOT EXISTS idx_instant_payouts_status ON instant_payouts(status);
