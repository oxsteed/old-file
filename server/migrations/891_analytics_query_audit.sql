-- 891: Analytics query audit ledger (analytics platform, Phase 3, Item 11).
-- Append-only ledger of every structured query-builder execution, written on
-- BOTH success and failure. Seeds the E15 query ledger: who ran what, the
-- compiled SQL that ran, how long it took, and how many rows came back.
-- raw_utterance is NULL for builder queries and carries the natural-language
-- text for NL queries (Track B).
-- No foreign key to users: the ledger must survive admin account lifecycle
-- changes (deletion, merge) without losing history, so admin_user_id is
-- recorded as-is. There is no UPDATE/DELETE path; rows are insert-only.
CREATE TABLE IF NOT EXISTS analytics_query_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  metric_name TEXT NOT NULL,
  dimensions JSONB,
  filters JSONB,
  period TEXT,
  row_count INTEGER,
  duration_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  raw_utterance TEXT,
  compiled_query JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_query_audit_admin ON analytics_query_audit(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_query_audit_metric ON analytics_query_audit(metric_name, created_at DESC);
