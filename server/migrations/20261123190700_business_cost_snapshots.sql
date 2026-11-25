-- Groups 5-6 item 249: frozen monthly operating cost snapshots.
CREATE TABLE IF NOT EXISTS business_cost_snapshots (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_month DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  version INTEGER NOT NULL DEFAULT 1,
  revenue_cents BIGINT NOT NULL,
  expense_cents BIGINT NOT NULL,
  labor_cents BIGINT NOT NULL,
  labor_hours NUMERIC(12,2) NOT NULL,
  expenses_by_category JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, period_month, version)
);
