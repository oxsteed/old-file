BEGIN;
-- NULL business context means OxSteed platform support, not a merchant tenant.
ALTER TABLE support_conversations ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE support_queue ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE conversation_assignments ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE queue_events ALTER COLUMN business_id DROP NOT NULL;
ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS live_wait_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_wait_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS founder_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_wait_ended_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_support_live_waiting
  ON support_conversations (live_wait_started_at)
  WHERE live_wait_started_at IS NOT NULL AND agent_id IS NULL;
COMMIT;
