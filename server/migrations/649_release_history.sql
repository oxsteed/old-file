-- M4: release history log. Releases are recorded manually from the
-- Reliability workspace in the admin console (there is no CI/deploy
-- webhook feed yet). Fail-safe: the table is append-only; nothing in
-- code deletes from it.

CREATE TABLE IF NOT EXISTS release_history (
  id BIGSERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'deployed'
    CHECK (status IN ('deployed', 'rolled_back', 'failed')),
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deployed_by UUID REFERENCES users(id),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_release_history_deployed_at
  ON release_history(deployed_at DESC);
