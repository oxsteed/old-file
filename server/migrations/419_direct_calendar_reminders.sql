-- Migration 419: Direct calendar reminder delivery ledger
-- The unique recipient key makes reminder sends idempotent across replicas.

CREATE TABLE IF NOT EXISTS direct_calendar_reminder_deliveries (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  reminder_type VARCHAR(24) NOT NULL CHECK (reminder_type IN ('24_hour', '2_hour')),
  recipient_email VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  last_error VARCHAR(500),
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, reminder_type, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_direct_calendar_reminders_due
  ON direct_calendar_reminder_deliveries (status, updated_at);
