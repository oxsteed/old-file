-- Migration 144: Idempotent retention columns for support_messages (046 table may predate 140)
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS message_type VARCHAR(50) DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '180 days',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE support_messages
SET sender_type = CASE WHEN is_from_admin THEN 'agent' ELSE 'customer' END
WHERE sender_type IS NULL;

ALTER TABLE IF EXISTS support_conversations
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_support_messages_expires_at ON support_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_id ON support_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_soft_delete ON support_messages(deleted_at) WHERE deleted_at IS NOT NULL;
