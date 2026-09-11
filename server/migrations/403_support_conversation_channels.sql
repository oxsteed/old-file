-- Stable channel identity for the unified support inbox.
-- Existing conversations remain web_chat for backward compatibility.
ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS external_thread_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS channel_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_channel_message_at TIMESTAMPTZ;

ALTER TABLE support_conversations
  DROP CONSTRAINT IF EXISTS support_conversations_channel_check;

ALTER TABLE support_conversations
  ADD CONSTRAINT support_conversations_channel_check
  CHECK (channel IN ('web_chat', 'email', 'sms', 'phone', 'social'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_conversations_external_thread
  ON support_conversations (business_id, channel, external_thread_id)
  WHERE external_thread_id IS NOT NULL;

ALTER TABLE support_conversation_messages
  ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'web_chat',
  ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255);

ALTER TABLE support_conversation_messages
  DROP CONSTRAINT IF EXISTS support_conversation_messages_channel_check;

ALTER TABLE support_conversation_messages
  ADD CONSTRAINT support_conversation_messages_channel_check
  CHECK (channel IN ('web_chat', 'email', 'sms', 'phone', 'social'));

CREATE INDEX IF NOT EXISTS idx_support_conversation_messages_channel
  ON support_conversation_messages (conversation_id, channel, created_at DESC);
