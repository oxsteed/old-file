-- Governed metric snapshot store (analytics decision 4).
-- One row per UTC day, metric, access scope and currency. Rows are written
-- only by the fenced snapshot worker (jobs/metricSnapshots.js) and are
-- immutable once written unless an explicit recompute backfill replaces them.
CREATE TABLE IF NOT EXISTS metric_snapshot_runs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('nightly', 'backfill')),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  recompute BOOLEAN NOT NULL DEFAULT FALSE,
  rows_written INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  requested_by UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CHECK (to_date >= from_date),
  CHECK ((status = 'running') = (finished_at IS NULL))
);
-- Fence: at most one run may be active, even if the advisory lock is lost.
CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshot_runs_one_running
  ON metric_snapshot_runs ((TRUE)) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS metric_daily_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  metric_name TEXT NOT NULL CHECK (metric_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  scope_key TEXT NOT NULL CHECK (scope_key = 'global' OR scope_key ~ '^regions:[0-9]+(,[0-9]+)*$'),
  region_ids INTEGER[],
  dimension_key TEXT NOT NULL DEFAULT '' CHECK (dimension_key = '' OR dimension_key ~ '^[A-Z]{3}$'),
  value NUMERIC,
  components JSONB NOT NULL DEFAULT '{}'::JSONB,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('daily_cohort', 'point_in_time')),
  source TEXT NOT NULL CHECK (source IN ('nightly', 'backfill')),
  definition_hash TEXT NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  run_id BIGINT NOT NULL REFERENCES metric_snapshot_runs(id),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT metric_daily_snapshots_scope_regions CHECK ((scope_key = 'global') = (region_ids IS NULL)),
  CONSTRAINT metric_daily_snapshots_unique UNIQUE (snapshot_date, metric_name, scope_key, dimension_key)
);
CREATE INDEX IF NOT EXISTS metric_daily_snapshots_series
  ON metric_daily_snapshots (metric_name, scope_key, dimension_key, snapshot_date DESC);

-- Trend reads disclose metric values, so they are audited like executions.
ALTER TABLE analytics_query_audit DROP CONSTRAINT IF EXISTS analytics_query_audit_event_type_check;
ALTER TABLE analytics_query_audit ADD CONSTRAINT analytics_query_audit_event_type_check
  CHECK (event_type IN ('execution','export','nl_parse','evidence','trend'));
