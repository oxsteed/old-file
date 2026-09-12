-- Migration 417: Direct dispatch assignment
-- Keep ownership separate from request lifecycle and schedule state.

ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_quote_requests_direct_assignment
  ON quote_requests (assigned_to, scheduled_start_at)
  WHERE assigned_to IS NOT NULL;
