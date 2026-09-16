-- Keep the newest provider event per object so delayed deliveries cannot
-- overwrite an authoritative state with an older transition.

ALTER TABLE webhook_event_receipts
  ADD COLUMN IF NOT EXISTS object_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS object_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS event_created BIGINT;

CREATE INDEX IF NOT EXISTS idx_webhook_event_receipts_object_order
  ON webhook_event_receipts(provider, object_type, object_id, event_created DESC);

CREATE TABLE IF NOT EXISTS webhook_event_watermarks (
  provider VARCHAR(50) NOT NULL,
  object_type VARCHAR(80) NOT NULL,
  object_id VARCHAR(255) NOT NULL,
  event_created BIGINT NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, object_type, object_id)
);
