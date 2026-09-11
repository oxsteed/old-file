-- Idempotent inbound events for provider-agnostic support channel adapters.
CREATE TABLE IF NOT EXISTS support_channel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel VARCHAR(20) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  external_thread_id VARCHAR(255) NOT NULL,
  external_message_id VARCHAR(255),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES support_conversations(id) ON DELETE SET NULL,
  payload_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processed',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (channel, event_id),
  CHECK (channel IN ('email', 'sms', 'phone', 'social')),
  CHECK (status IN ('processed', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_channel_external_message
  ON support_conversation_messages (channel, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_channel_events_conversation
  ON support_channel_events (conversation_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_channel_events_thread
  ON support_channel_events (business_id, channel, external_thread_id, received_at DESC);
