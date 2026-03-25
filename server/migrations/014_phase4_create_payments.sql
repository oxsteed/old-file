-- Phase 4: Payments table for Tier 3 Protected Payments
-- Escrow-style payments via Stripe Connect
-- Platform holds funds until job completion confirmed

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES users(id),
  payee_id UUID NOT NULL REFERENCES users(id),
  stripe_payment_intent_id VARCHAR(255),
  stripe_transfer_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  amount NUMERIC(10, 2) NOT NULL,
  platform_fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
  platform_fee_percent NUMERIC(5, 2) DEFAULT 15.00,
  helper_payout NUMERIC(10, 2),
  currency VARCHAR(3) DEFAULT 'usd',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  -- pending, authorized, captured, released, refunded, disputed, failed
  escrow_status VARCHAR(30) DEFAULT 'none',
  -- none, held, released, refunded
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_amount NUMERIC(10, 2),
  refund_reason TEXT,
  failure_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_job_id ON payments(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer_id ON payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payee_id ON payments(payee_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_escrow ON payments(escrow_status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi ON payments(stripe_payment_intent_id);

-- Connect accounts table for Stripe Connect onboarding
CREATE TABLE IF NOT EXISTS connect_accounts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(255) NOT NULL UNIQUE,
  charges_enabled BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,
  onboarding_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connect_accounts_user ON connect_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_connect_accounts_stripe ON connect_accounts(stripe_account_id);
