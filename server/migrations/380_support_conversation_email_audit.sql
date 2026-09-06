BEGIN;

ALTER TABLE support_conversation_messages
  ADD COLUMN IF NOT EXISTS email_subject VARCHAR(200),
  ADD COLUMN IF NOT EXISTS email_request_id UUID,
  ADD COLUMN IF NOT EXISTS email_provider_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_conversation_email_request
  ON support_conversation_messages (email_request_id)
  WHERE email_request_id IS NOT NULL;

COMMIT;
