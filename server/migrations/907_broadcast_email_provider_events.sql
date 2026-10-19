-- Resend delivery webhooks for broadcast email (analytics deferred item).
-- Additive. "sent" stays "accepted by the provider"; delivered/bounced/
-- complained/failed come only from signed provider events. Events are deduped
-- through webhook_event_receipts(provider='resend', event_id=svix-id).

ALTER TABLE business_broadcast_deliveries
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_type TEXT,
  ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bbd_provider_message
  ON business_broadcast_deliveries(provider_message_id)
  WHERE provider_message_id IS NOT NULL AND channel = 'email';

-- Hard bounces and spam complaints suppress further broadcast email from
-- that business to that address.
ALTER TABLE business_broadcast_suppressions DROP CONSTRAINT IF EXISTS business_broadcast_suppressions_source_check;
ALTER TABLE business_broadcast_suppressions ADD CONSTRAINT business_broadcast_suppressions_source_check
  CHECK (source IN ('unsubscribe_link', 'one_click', 'owner', 'hard_bounce', 'complaint'));
