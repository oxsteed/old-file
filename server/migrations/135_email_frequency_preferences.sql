-- Migration 135: Email frequency preferences and digest queue
-- Enables granular control over email notifications with daily/weekly digest options

-- Only alter table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences') THEN
    ALTER TABLE notification_preferences
      ADD COLUMN IF NOT EXISTS email_frequency VARCHAR(20) DEFAULT 'real-time',
      ADD COLUMN IF NOT EXISTS unsubscribe_all BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS unsubscribed_from_bulk_emails BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS email_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- Unsubscribe tokens for email footer links (one-click unsubscribe)
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_tokens_user ON email_unsubscribe_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_tokens_token ON email_unsubscribe_tokens(token);

-- Queue for batching notifications into daily/weekly digests
CREATE TABLE IF NOT EXISTS email_digest_queue (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  digest_type VARCHAR(20),
  queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP,
  UNIQUE(notification_id)
);

CREATE INDEX IF NOT EXISTS idx_email_digest_queue_user ON email_digest_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_email_digest_queue_unsent ON email_digest_queue(user_id) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_digest_queue_queued ON email_digest_queue(queued_at);
