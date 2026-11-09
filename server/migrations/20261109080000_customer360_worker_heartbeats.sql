-- Customer 360 gap fill 8: per-task heartbeats for the Customer 360
-- background loop (jobs/customer360Upgrades.js), so the admin summary-health
-- screen can show whether the worker is running, late or failing from any
-- API instance. One row per task; upserted after every run. No customer data.
CREATE TABLE IF NOT EXISTS customer360_worker_heartbeats (
  task              VARCHAR(60) PRIMARY KEY,
  every_ms          INTEGER     NOT NULL CHECK (every_ms > 0),
  last_started_at   TIMESTAMPTZ NOT NULL,
  last_finished_at  TIMESTAMPTZ,
  last_ok_at        TIMESTAMPTZ,
  last_error_at     TIMESTAMPTZ,
  last_error_code   VARCHAR(80),
  last_duration_ms  INTEGER CHECK (last_duration_ms IS NULL OR last_duration_ms >= 0),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  runs              BIGINT      NOT NULL DEFAULT 0,
  failures          BIGINT      NOT NULL DEFAULT 0,
  instance          VARCHAR(120),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
