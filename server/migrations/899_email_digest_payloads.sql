-- Email-only digest payloads. Additive only.

-- Email-only digest entries. A caller that suppresses the in-app channel
--    must not create a visible notification row, so the queue keeps its own
--    localized payload for those entries.
ALTER TABLE email_digest_queue ALTER COLUMN notification_id DROP NOT NULL;
ALTER TABLE email_digest_queue ADD COLUMN IF NOT EXISTS notification_type TEXT;
ALTER TABLE email_digest_queue ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE email_digest_queue ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE email_digest_queue ADD COLUMN IF NOT EXISTS delivery_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS email_digest_queue_delivery_key
  ON email_digest_queue(delivery_key) WHERE delivery_key IS NOT NULL;
ALTER TABLE email_digest_queue DROP CONSTRAINT IF EXISTS email_digest_queue_payload_check;
ALTER TABLE email_digest_queue ADD CONSTRAINT email_digest_queue_payload_check
  CHECK (notification_id IS NOT NULL OR (title IS NOT NULL AND delivery_key IS NOT NULL));
