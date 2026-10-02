-- T56-F04: persist legal document drafts in the database instead of a
-- process-local Map. Restarts and multi-node deployments must not lose or
-- disagree on draft/approval state.

CREATE TABLE IF NOT EXISTS legal_document_drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_summary TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_legal_document_drafts_status
  ON legal_document_drafts(status);
