-- Migration 635: OxSteed Credit automated settlement cycles (Phase 3 gap 3).
--
-- Adds the `oxsteed_credit_settlement_cycles` table: one row per closed
-- settlement period per cycle type. The nightly settlement-cycle job inserts
-- these rows idempotently (UNIQUE (cycle_type, period_start)) and then
-- creates one pending settlement per (partner, currency) with activity in the
-- period. Approval stays a human action; the job never marks paid.
--
-- Date semantics:
--   period_start / period_end : half-open UTC window [period_start, period_end).
--     Activity with a posted timestamp >= period_end belongs to the next
--     period (cut-off exactness).
--   cutoff_at                : equals period_end; recorded explicitly so the
--     cut-off instant is auditable on the cycle row itself.
--   value_date               : the DATE of period_end, i.e. when the settled
--     activity occurred.
--   settlement_date          : the next business day on or after period_end
--     (weekends shift to Monday; see
--     server/services/oxsteedCreditSettlementCalendar.js), i.e. when the
--     obligation is due to be paid.
--
-- Also links settlements to their cycle (cycle_id, value_date,
-- settlement_date) and extends migration 448's immutability trigger: the
-- cycle linkage and the two dates are snapshot facts and cannot change after
-- the settlement row is created.

CREATE TABLE IF NOT EXISTS oxsteed_credit_settlement_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_type VARCHAR(16) NOT NULL
    CHECK (cycle_type IN ('daily', 'weekly')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  value_date DATE NOT NULL,
  settlement_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_oxsteed_credit_settlement_cycles_type_period
    UNIQUE (cycle_type, period_start),
  CONSTRAINT oxsteed_credit_settlement_cycles_period_check
    CHECK (period_end > period_start)
);

COMMENT ON COLUMN oxsteed_credit_settlement_cycles.value_date IS
  'DATE of period_end: when the settled activity occurred.';
COMMENT ON COLUMN oxsteed_credit_settlement_cycles.settlement_date IS
  'Next business day on/after period_end: when the obligation is due to be paid.';

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_settlement_cycles_status
  ON oxsteed_credit_settlement_cycles (status, period_start);

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS cycle_id UUID NULL
  REFERENCES oxsteed_credit_settlement_cycles(id) ON DELETE SET NULL;

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS value_date DATE NULL;

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS settlement_date DATE NULL;

COMMENT ON COLUMN oxsteed_credit_settlements.cycle_id IS
  'Settlement cycle that created this snapshot; NULL for manually created settlements.';
COMMENT ON COLUMN oxsteed_credit_settlements.value_date IS
  'DATE of period_end: when the settled activity occurred (snapshot fact).';
COMMENT ON COLUMN oxsteed_credit_settlements.settlement_date IS
  'Next business day on/after period_end: when the obligation is due (snapshot fact).';

-- Extend migration 448: cycle_id, value_date, and settlement_date are
-- snapshot facts and join the immutable field set.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.partner_id IS DISTINCT FROM OLD.partner_id
       OR NEW.agreement_id IS DISTINCT FROM OLD.agreement_id
       OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.gross_cents IS DISTINCT FROM OLD.gross_cents
       OR NEW.refund_cents IS DISTINCT FROM OLD.refund_cents
       OR NEW.fee_cents IS DISTINCT FROM OLD.fee_cents
       OR NEW.net_cents IS DISTINCT FROM OLD.net_cents
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id
       OR NEW.value_date IS DISTINCT FROM OLD.value_date
       OR NEW.settlement_date IS DISTINCT FROM OLD.settlement_date) THEN
    RAISE EXCEPTION 'OxSteed Credit settlement snapshot fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('approved', 'paid') AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'An approved or paid OxSteed Credit settlement requires approval evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_immutability_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_immutability_guard
  BEFORE INSERT OR UPDATE OF partner_id, agreement_id, currency_code, period_start,
    period_end, gross_cents, refund_cents, fee_cents, net_cents, idempotency_key,
    created_by, created_at, status, approved_by, cycle_id, value_date, settlement_date
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_immutability();
