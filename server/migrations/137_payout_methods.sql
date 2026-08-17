-- Migration 137: Payout Method Management
-- Add payout method storage and tracking for seller withdrawals

CREATE TABLE IF NOT EXISTS payout_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_type VARCHAR(50) NOT NULL, -- 'bank_account', 'paypal', 'stripe_connect'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'active', 'inactive'
  is_primary BOOLEAN DEFAULT FALSE,

  -- Bank account details (encrypted in production)
  account_holder_name VARCHAR(255),
  bank_name VARCHAR(255),
  account_last_four VARCHAR(4),
  routing_number_last_four VARCHAR(4),
  account_type VARCHAR(50), -- 'checking', 'savings'

  -- PayPal details
  paypal_email VARCHAR(255),

  -- Stripe Connect details
  stripe_account_id VARCHAR(255),

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT method_type_check CHECK (method_type IN ('bank_account', 'paypal', 'stripe_connect'))
);

-- Enforce only one primary payout method per helper using a partial unique index
-- (PostgreSQL does not support WHERE clauses on table-level UNIQUE constraints)
CREATE UNIQUE INDEX IF NOT EXISTS unique_primary_method_per_helper ON payout_methods(helper_id) WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_payout_methods_helper_id ON payout_methods(helper_id);
CREATE INDEX IF NOT EXISTS idx_payout_methods_status ON payout_methods(status);

-- Extend affiliate_payouts table with additional fields
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS payout_method_id UUID REFERENCES payout_methods(id);
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS payment_processor VARCHAR(50); -- 'stripe', 'paypal', 'ach'
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS processor_fee_cents BIGINT DEFAULT 0;
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS net_payout_cents BIGINT; -- gross - fees
ALTER TABLE IF EXISTS affiliate_payouts ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_payout_method_id ON affiliate_payouts(payout_method_id);

-- Track payout history and status changes
CREATE TABLE IF NOT EXISTS payout_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES affiliate_payouts(id) ON DELETE CASCADE,
  transaction_status VARCHAR(50) NOT NULL, -- 'initiated', 'processing', 'completed', 'failed', 'refunded'
  external_transaction_id VARCHAR(255),
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_transactions_payout_id ON payout_transactions(payout_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_status ON payout_transactions(transaction_status);

-- Payout reconciliation table for matching payments to bank statements
CREATE TABLE IF NOT EXISTS payout_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payout_id UUID REFERENCES affiliate_payouts(id),
  bank_amount_cents BIGINT NOT NULL,
  bank_date DATE NOT NULL,
  bank_reference VARCHAR(255),
  reconciled BOOLEAN DEFAULT FALSE,
  reconciled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_reconciliation_helper_id ON payout_reconciliation(helper_id);
CREATE INDEX IF NOT EXISTS idx_payout_reconciliation_reconciled ON payout_reconciliation(reconciled);
