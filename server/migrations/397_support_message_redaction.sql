-- Preserve support message history while allowing authorized staff to remove
-- sensitive content and attachment references from future conversation views.
ALTER TABLE support_conversation_messages
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redaction_reason VARCHAR(1000);

CREATE INDEX IF NOT EXISTS idx_support_message_redactions
  ON support_conversation_messages (redacted_at)
  WHERE redacted_at IS NOT NULL;
