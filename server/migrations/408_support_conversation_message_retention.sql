-- Give the active support conversation table the same retention contract as
-- the legacy support_messages table. Redaction preserves case metrics while
-- removing customer message content and attachment references after expiry.
ALTER TABLE support_conversation_messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE support_conversation_messages
SET expires_at = created_at + INTERVAL '180 days'
WHERE expires_at IS NULL;

ALTER TABLE support_conversation_messages
  ALTER COLUMN expires_at SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '180 days'),
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_conversation_messages_retention
  ON support_conversation_messages (expires_at)
  WHERE redacted_at IS NULL;
