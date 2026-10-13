-- Review W2 (P3-891): failed webhook receipts get an operator recovery path.
-- Store the connected account so a Connect event can be re-fetched from
-- Stripe, and record manual resolutions.
ALTER TABLE webhook_event_receipts ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE webhook_event_receipts ADD COLUMN IF NOT EXISTS resolved_by UUID;
ALTER TABLE webhook_event_receipts ADD COLUMN IF NOT EXISTS resolution_note TEXT;
CREATE INDEX IF NOT EXISTS idx_webhook_event_receipts_failed
  ON webhook_event_receipts (provider, last_seen_at DESC) WHERE status = 'failed';
