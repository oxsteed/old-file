-- Stable outcome taxonomy for support QA, reporting, and escalation analysis.
ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS resolution_reason_code VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_support_conversations_resolution_reason
  ON support_conversations (business_id, resolution_reason_code, resolved_at)
  WHERE resolution_reason_code IS NOT NULL;
