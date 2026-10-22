-- Migration 1404: F-22 pay-run records.
--
-- A pay run is an immutable snapshot of one payroll period: wages and
-- tips per employee as computed at finalization time, so the exported
-- CSV always matches what was approved, even if wages or time entries
-- change afterwards. Drafts may be rebuilt; finalized runs are
-- append-only (voiding creates a new voided state, never deletes).

CREATE TABLE IF NOT EXISTS restaurant_pay_runs (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'voided')),
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_by UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_from <= period_to)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pay_runs_restaurant
  ON restaurant_pay_runs(restaurant_id, period_from DESC, period_to DESC);

CREATE TABLE IF NOT EXISTS restaurant_pay_run_lines (
  id BIGSERIAL PRIMARY KEY,
  pay_run_id BIGINT NOT NULL REFERENCES restaurant_pay_runs(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  staff_label VARCHAR(160),
  regular_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  hourly_wage_cents INTEGER,
  regular_wages_cents INTEGER,
  overtime_wages_cents INTEGER,
  wages_cents INTEGER,
  gross_tips_cents INTEGER NOT NULL DEFAULT 0,
  net_tips_cents INTEGER NOT NULL DEFAULT 0,
  total_pay_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pay_run_lines_run
  ON restaurant_pay_run_lines(pay_run_id, id);
