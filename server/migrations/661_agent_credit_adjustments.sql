-- Migration 661: Agent OxSteed Credit adjustments (two-person rule).
--
-- Manual credit movements by support agents need human supervision. This
-- table records every agent-initiated adjustment proposal and gates money
-- movement on a second admin's approval once the amount is material.
--
-- Rules (enforced in server/controllers/agentCreditAdjustmentController.js):
--   * below $50.00 (5000 cents): a single grant-holder proposes AND the
--     adjustment applies immediately in one call, with a required reason and
--     a full audit entry.
--   * at or above $50.00: propose() only creates a PENDING row. A different
--     admin must approve() before any posting happens; self-approval is a
--     hard 403.
--   * money moves only inside one transaction that also flips the row to
--     'applied' and writes before/after balances. A disabled/frozen credit
--     rail or any posting error fails closed: the row stays 'pending'.
-- The ledger posting itself reuses postJournalTransaction / the 'adjustment'
-- transaction type (treasury -> customer_wallet for credits, customer_wallet
-- -> treasury for debits); the adjustment row is the audit wrapper.
-- Idempotency: idempotency_key is UNIQUE. A retried propose with the same
-- key returns the existing row instead of creating a duplicate.

CREATE TABLE IF NOT EXISTS credit_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  currency_code TEXT NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL CHECK (char_length(reason) <= 2000),
  proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'applied', 'rejected', 'cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  before_balance_cents BIGINT,
  after_balance_cents BIGINT,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  reject_reason TEXT,
  ledger_transaction_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_adjustments_status
  ON credit_adjustments (status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_adjustments_proposer
  ON credit_adjustments (proposed_by, proposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_adjustments_customer
  ON credit_adjustments (customer_id, created_at DESC);
