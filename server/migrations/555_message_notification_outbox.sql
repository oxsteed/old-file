-- Migration 555: durable notification delivery for direct messages.
-- Message commits and recipient notification intent must survive a process
-- crash between the database commit and asynchronous delivery.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS delivery_key VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_delivery_key
  ON notifications (delivery_key)
  WHERE delivery_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_notification_outbox (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_message_notification_outbox_due
  ON message_notification_outbox (next_attempt_at, created_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_message_notification_outbox_locks
  ON message_notification_outbox (locked_at, created_at, id)
  WHERE status = 'sending';
