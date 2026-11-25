-- Groups 5-6 item 265 (G5-5 HIGH): job exceptions for OxSteed service jobs.
-- The only exception systems before this were delivery-only, reconciliation
-- (admin-only), and support-case escalation: a crew member on a job had no
-- in-app way to route a locked gate / wrong scope / unsafe site to the
-- manager. One row per report, participant-scoped reads (client, assigned
-- helper, routed manager), manager-routed via routed_to. Additive and
-- idempotent.
CREATE TABLE IF NOT EXISTS job_exceptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  raised_by     UUID NOT NULL REFERENCES users(id),
  routed_to     UUID REFERENCES users(id),
  kind          TEXT NOT NULL
    CHECK (kind IN ('exception', 'missing_instruction', 'incident', 'access_denied', 'reassignment_request')),
  category      TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('low', 'normal', 'high', 'critical')),
  description   TEXT NOT NULL CHECK (char_length(description) BETWEEN 5 AND 2000),
  status        TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  resolution    TEXT CHECK (resolution IS NULL OR char_length(resolution) BETWEEN 1 AND 1000),
  request_id    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  CONSTRAINT job_exceptions_unique_report
    UNIQUE (job_id, raised_by, request_id)
);

CREATE INDEX IF NOT EXISTS idx_job_exceptions_job_created
  ON job_exceptions (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_exceptions_routed_open
  ON job_exceptions (routed_to, status) WHERE status IN ('open', 'acknowledged');
