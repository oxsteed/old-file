-- Track externally delivered webhook event IDs so replayed webhooks cannot
-- re-run side effects after a successful processing pass.

CREATE TABLE IF NOT EXISTS webhook_event_receipts (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'processing',
  attempts INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE(provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_receipts_status
  ON webhook_event_receipts(provider, status, last_seen_at DESC);
