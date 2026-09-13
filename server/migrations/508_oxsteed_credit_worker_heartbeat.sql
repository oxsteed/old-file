-- Migration 508: durable health checkpoints for Credit scheduled workers.
-- A heartbeat is operational telemetry, not ledger state; it is intentionally mutable.

CREATE TABLE IF NOT EXISTS oxsteed_credit_worker_heartbeats (
  job_name TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_count INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_worker_heartbeats_last_run
  ON oxsteed_credit_worker_heartbeats (last_run_at, job_name);
