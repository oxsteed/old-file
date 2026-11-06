-- Migration 20261106093000: Phase 5 money controls on pay runs.
--
-- Dual control (maker-checker, same pattern as moneyApprovalService /
-- dualApprovalService): a finalized pay run needs a second, distinct
-- payroll.manage holder to approve it before it can be exported or
-- linked to a payout. approved_by / approved_at record the checker;
-- the CHECK constraint is the second line of defense behind the
-- controller's maker != checker rejection.
--
-- Tip-out / tip-in on pay-run lines: computeLabor already computes
-- them, but payRunLinesFromLabor dropped them, so finalized stubs
-- could not show the tip breakdown. Lines created before this
-- migration keep 0 (their runs are already immutable snapshots).
--
-- Disbursement ledger: per-employee payment records linked to run
-- lines. A run is markable paid only when every line is covered and
-- the per-employee amounts sum to the run total. Amounts are integer
-- minor units in the run's currency; no hardcoded currency.

ALTER TABLE restaurant_pay_runs
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE restaurant_pay_runs
  DROP CONSTRAINT IF EXISTS restaurant_pay_runs_approval_check;
ALTER TABLE restaurant_pay_runs
  ADD CONSTRAINT restaurant_pay_runs_approval_check
    CHECK (approved_by IS NULL OR approved_by <> finalized_by);

ALTER TABLE restaurant_pay_run_lines
  ADD COLUMN IF NOT EXISTS tip_out_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_in_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS restaurant_pay_run_disbursements (
  id BIGSERIAL PRIMARY KEY,
  pay_run_id BIGINT NOT NULL REFERENCES restaurant_pay_runs(id) ON DELETE CASCADE,
  pay_run_line_id BIGINT NOT NULL REFERENCES restaurant_pay_run_lines(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  staff_label VARCHAR(160),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency_code VARCHAR(3) NOT NULL,
  method VARCHAR(32) NOT NULL DEFAULT 'bank_transfer'
    CHECK (method IN ('bank_transfer', 'cash', 'check', 'provider_export')),
  reference VARCHAR(160),
  note VARCHAR(500),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One disbursement per pay-run line: a line is paid exactly once,
  -- so the per-employee amounts can never double-count a line.
  UNIQUE (pay_run_line_id)
);

CREATE INDEX IF NOT EXISTS idx_pay_run_disbursements_run
  ON restaurant_pay_run_disbursements(pay_run_id);
CREATE INDEX IF NOT EXISTS idx_pay_run_disbursements_staff
  ON restaurant_pay_run_disbursements(pay_run_id, staff_user_id);
