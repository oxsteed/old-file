-- Durable delivery attempts for replies sent through external support channels.
-- Message content remains in support_conversation_messages; this table stores
-- provider state and operational metadata only.
BEGIN;

CREATE TABLE IF NOT EXISTS support_channel_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES support_conversation_messages(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'phone', 'social')),
  provider VARCHAR(40) NOT NULL,
  recipient VARCHAR(320) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed', 'not_configured', 'unsupported')),
  provider_message_id VARCHAR(255),
  idempotency_key UUID NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 0),
  error_code VARCHAR(80),
  error_message VARCHAR(2000),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_channel_deliveries_conversation
  ON support_channel_deliveries (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_channel_deliveries_status
  ON support_channel_deliveries (status, updated_at DESC)
  WHERE status IN ('sending', 'failed', 'not_configured');

COMMIT;
