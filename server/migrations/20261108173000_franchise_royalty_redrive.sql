-- Background-jobs audit #45: franchise royalty re-drive.
--
-- (a) The marketing-fee share was a bare UPDATE with no idempotency:
-- a repeated accrue for the same revenue event double-counted the
-- fee (notably when the royalty rounded to 0 and the ledger insert
-- was skipped), and a crash between the royalty insert and the fee
-- UPDATE lost the fee permanently (the retry returned `duplicate`
-- before reaching the UPDATE). franchise_marketing_fee_accruals is
-- the fee's idempotency record: one row per (agreement, source),
-- and the agreement UPDATE runs only when that row is newly
-- inserted, in the same statement (see franchiseRoyaltyService).
--
-- (b) Every accrue call site swallowed failures warn-only, and the
-- revenue event was already terminal, so a transient DB failure lost
-- the royalty (and/or fee) permanently with no re-drive.
-- franchise_royalty_failures is the retryable outbox: a failed
-- accrual is recorded keyed by (source_type, source_id) and
-- re-driven by the hourly franchise-royalty-redrive job until it
-- accrues or the source no longer matches a launched agreement.
-- The partial unique index lets a new failure be recorded for a
-- source whose earlier failure was resolved.

CREATE TABLE IF NOT EXISTS franchise_marketing_fee_accruals (
  id BIGSERIAL PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES franchise_agreements(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  marketing_cents INTEGER NOT NULL CHECK (marketing_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT franchise_marketing_fee_accruals_source_unique
    UNIQUE (agreement_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS franchise_royalty_failures (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  agreement_id UUID REFERENCES franchise_agreements(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  location_id BIGINT,
  city TEXT,
  region TEXT,
  description TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS franchise_royalty_failures_open_source_unique
  ON franchise_royalty_failures (source_type, source_id) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS franchise_royalty_failures_due_idx
  ON franchise_royalty_failures (next_retry_at, id) WHERE resolved_at IS NULL;
