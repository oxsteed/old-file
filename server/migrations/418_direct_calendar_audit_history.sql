-- Migration 418: Direct calendar audit history
-- Preserve dispatch accountability without exposing audit records publicly.

CREATE TABLE IF NOT EXISTS direct_calendar_audit_history (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT REFERENCES quote_requests(id) ON DELETE SET NULL,
  block_id BIGINT REFERENCES direct_calendar_blocks(id) ON DELETE SET NULL,
  action VARCHAR(48) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (request_id IS NOT NULL OR block_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_direct_calendar_audit_created
  ON direct_calendar_audit_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_calendar_audit_request
  ON direct_calendar_audit_history (request_id, created_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_direct_calendar_audit_block
  ON direct_calendar_audit_history (block_id, created_at DESC)
  WHERE block_id IS NOT NULL;
