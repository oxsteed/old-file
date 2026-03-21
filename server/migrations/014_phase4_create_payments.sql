-- Phase 4: Payments table for Tier 3 Protected Payments
-- Escrow-style payments via Stripe Connect
-- Platform holds funds until job completion confirmed

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payer_id INTEGER NOT NULL REFERENCES users(id),
  payee_id INTEGER NOT NULL REFERENCES users(id),
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

-- Stripe Connect accounts for helpers
CREATE TABLE IF NOT EXISTS connect_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(255) NOT NULL UNIQUE,
  account_type VARCHAR(20) DEFAULT 'express',
  charges_enabled BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,
  details_submitted BOOLEAN DEFAULT false,
  onboarding_complete BOOLEAN DEFAULT false,
  default_currency VARCHAR(3) DEFAULT 'usd',
  country VARCHAR(2) DEFAULT 'US',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payments_job_id ON payments(job_id);
CREATE INDEX idx_payments_payer_id ON payments(payer_id);
CREATE INDEX idx_payments_payee_id ON payments(payee_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_escrow ON payments(escrow_status);
CREATE INDEX idx_payments_stripe_pi ON payments(stripe_payment_intent_id);
CREATE INDEX idx_connect_user_id ON connect_accounts(user_id);
CREATE INDEX idx_connect_stripe_id ON connect_accounts(stripe_account_id);
