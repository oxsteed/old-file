-- D-ENG-08: durable evidence for the seven-day consent audit exit criterion.
CREATE TABLE IF NOT EXISTS growth_consent_audit_runs (
  id BIGSERIAL PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  subjects_checked INTEGER NOT NULL DEFAULT 0 CHECK (subjects_checked >= 0),
  events_checked BIGINT NOT NULL DEFAULT 0 CHECK (events_checked >= 0),
  violations INTEGER NOT NULL DEFAULT 0 CHECK (violations >= 0),
  status TEXT NOT NULL CHECK (status IN ('complete','skipped','failed')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS growth_consent_audit_runs_window_idx
  ON growth_consent_audit_runs(window_end DESC);
