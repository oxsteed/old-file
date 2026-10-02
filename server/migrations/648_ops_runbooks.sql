-- Migration 648: ops runbook registry for M3 (Global Service Operations).
--
-- Runbooks are the on-call procedures operators follow for incidents,
-- deployments, safety escalations, vendor issues, and compliance events.
-- This table is the registry surface only: it stores the procedures, it does
-- not page anyone. On-call paging is not implemented in this migration.
--
-- Updates bump `version` and stamp `updated_by`; deletes are soft
-- (is_active = FALSE) so historical procedures stay auditable.

CREATE TABLE IF NOT EXISTS ops_runbooks (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL
              CHECK (category IN ('incident', 'deployment', 'safety', 'vendor', 'compliance')),
  body        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_runbooks_category
  ON ops_runbooks (category)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ops_runbooks_code
  ON ops_runbooks (code)
  WHERE is_active = TRUE;
