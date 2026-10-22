-- D11/D12: auditable ClickHouse backup, restore-check, upgrade, and health
-- operations. The table contains metadata only; backup contents stay in the
-- configured same-region encrypted object store.
CREATE TABLE IF NOT EXISTS growth_ops_runs (
  id BIGSERIAL PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('backup','restore_check','upgrade','health')),
  status TEXT NOT NULL CHECK (status IN ('started','complete','failed','skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  backup_ref TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS growth_ops_runs_operation_idx
  ON growth_ops_runs(operation, started_at DESC);
