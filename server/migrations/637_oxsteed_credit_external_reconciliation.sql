-- Migration 637: OxSteed Credit external reconciliation (Phase 4, gap 7).
--
-- The internal reconciliation (migration 421/446) compares the append-only
-- journal against account balances, and the sub-bank check (migration 632)
-- compares restaurant sub-banks against food-wallet outstanding. Neither
-- compares our fiat records against the external provider. This migration
-- adds the evidence tables for a Stripe-backed external reconciliation:
--
--   oxsteed_credit_external_reconciliation_runs
--     One row per (currency, scheduled or manual run). A scheduled run
--     covers the prior UTC day; a manual admin trigger covers an explicit
--     period capped at 31 days. Counts are split by side (top-ups IN,
--     payouts OUT) and by outcome (matched, missing in Stripe,
--     missing in our ledger, reversed). `material` marks whether any
--     finding crossed the materiality threshold (missing_in_stripe and
--     reversed_in_stripe are always material); `freeze_engaged` marks
--     whether this run opened an operator freeze.
--
--   oxsteed_credit_rail_freezes
--     Operator freeze on every money-initiation path (distinct from the
--     rail kill switch in migration 422). At most one open freeze at a
--     time, enforced by a partial unique index. Engaged automatically by
--     a material external-reconciliation finding, or manually by a
--     super-admin. Clearing records who cleared it and why. The freeze is
--     independent of the rail enabled/suspended toggle.
--
--   reconciliation_exceptions gains the 'credit_external' domain. The
--     existing 'credit' domain is owned by food-wallet refund
--     reconciliation paths, so this job gets its own domain to keep
--     reference ids unambiguous.
--
--   oxsteed_credit_settlements gains payout_destination_account, recorded
--     at payout initiation so future reconciliation can verify the Stripe
--     transfer destination, not just amount and currency. Rows created
--     before this migration keep destination NULL and are verified on
--     amount + currency + transfer metadata only.
--
-- Corrections policy (application-level, see
-- server/services/oxsteedCreditExternalReconciliation.js): NO auto-correct
-- of the journal. The journal is append-only; corrections are compensating
-- entries created explicitly by an admin.

CREATE TABLE IF NOT EXISTS oxsteed_credit_external_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  scope VARCHAR(32) NOT NULL DEFAULT 'period',
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'matched', 'mismatch', 'failed')),
  topups_checked INTEGER NOT NULL DEFAULT 0,
  topups_matched INTEGER NOT NULL DEFAULT 0,
  topups_missing_in_stripe INTEGER NOT NULL DEFAULT 0,
  topups_missing_in_ledger INTEGER NOT NULL DEFAULT 0,
  payouts_checked INTEGER NOT NULL DEFAULT 0,
  payouts_matched INTEGER NOT NULL DEFAULT 0,
  payouts_missing_in_stripe INTEGER NOT NULL DEFAULT 0,
  payouts_reversed_in_stripe INTEGER NOT NULL DEFAULT 0,
  partner_checks INTEGER NOT NULL DEFAULT 0,
  partner_mismatches INTEGER NOT NULL DEFAULT 0,
  material BOOLEAN NOT NULL DEFAULT FALSE,
  freeze_engaged BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (period_end > period_start)
);
CREATE INDEX IF NOT EXISTS idx_credit_external_recon_history
  ON oxsteed_credit_external_reconciliation_runs (currency_code, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS oxsteed_credit_rail_freezes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reason TEXT NOT NULL,
  incident_ref TEXT,
  frozen_by UUID REFERENCES users(id) ON DELETE SET NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ,
  cleared_by UUID REFERENCES users(id) ON DELETE SET NULL,
  clear_reason TEXT
);
-- At most one open freeze: every open row has cleared_at IS NULL, and the
-- constant expression makes them conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_rail_freeze_open
  ON oxsteed_credit_rail_freezes ((1)) WHERE cleared_at IS NULL;

-- New exception domain for this job; the CHECK constraint is re-created
-- with 'credit_external' added (existing values untouched).
ALTER TABLE reconciliation_exceptions
  DROP CONSTRAINT IF EXISTS reconciliation_exceptions_domain_check;
ALTER TABLE reconciliation_exceptions
  ADD CONSTRAINT reconciliation_exceptions_domain_check
  CHECK (domain IN ('credit', 'payment_refund', 'marketplace_refund', 'external_refund', 'payout_settlement', 'credit_external'));

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS payout_destination_account VARCHAR(255);
