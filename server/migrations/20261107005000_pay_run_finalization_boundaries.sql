-- Migration 20261107005000: pay-run finalization boundaries (design
-- review 2026-11-06, findings 5 and 9).
--
-- Finding 9: the disbursement ledger had no correction path. A
-- disbursement is now reversible, never deletable: status flips to
-- 'voided' with voided_by / voided_at / void_reason, and the row stays
-- visible in the ledger. Only 'recorded' rows count toward coverage.
--
-- Finding 5: inputs recorded after a run finalizes (late premiums,
-- late-confirmed cash tips, late-approved punch corrections) are
-- carried into the next run as clearly-marked lines instead of
-- vanishing. restaurant_pay_run_lines gains the marker columns
-- (which source run a line was carried from, and what kind of input),
-- and restaurant_pay_run_carry_forwards records every carried input
-- so no input is ever carried twice: premiums and cash tips dedup on
-- (input_type, input_id), correction-hour deltas dedup per
-- (source run, employee) with the carried hours in details.
ALTER TABLE restaurant_pay_run_disbursements
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'voided')),
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE restaurant_pay_run_lines
  ADD COLUMN IF NOT EXISTS carry_forward_source_run_id BIGINT
    REFERENCES restaurant_pay_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carry_forward_kind VARCHAR(32)
    CHECK (carry_forward_kind IS NULL
      OR carry_forward_kind IN ('premium', 'cash_tip', 'correction_hours', 'mixed'));

CREATE TABLE IF NOT EXISTS restaurant_pay_run_carry_forwards (
  id BIGSERIAL PRIMARY KEY,
  source_pay_run_id BIGINT NOT NULL REFERENCES restaurant_pay_runs(id) ON DELETE CASCADE,
  target_pay_run_id BIGINT NOT NULL REFERENCES restaurant_pay_runs(id) ON DELETE CASCADE,
  input_type VARCHAR(32) NOT NULL
    CHECK (input_type IN ('premium', 'cash_tip', 'correction_hours')),
  -- The source input row (schedule-change id, cash-tip declaration id).
  -- NULL for correction_hours, which is a per-employee hours delta
  -- aggregated from the recompute, not a single row.
  input_id BIGINT,
  staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One input carries forward at most once, ever.
  UNIQUE (input_type, input_id)
);
CREATE INDEX IF NOT EXISTS idx_pay_run_carry_forwards_source
  ON restaurant_pay_run_carry_forwards (source_pay_run_id, staff_user_id);
CREATE INDEX IF NOT EXISTS idx_pay_run_carry_forwards_target
  ON restaurant_pay_run_carry_forwards (target_pay_run_id);
