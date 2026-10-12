-- Migration 778 (review P3-846): stale-worker fencing for the OxSteed Credit
-- notification outbox, matching what 592 added to the message and support
-- outboxes. Finishing a row requires the lease token from its claim.
ALTER TABLE oxsteed_credit_notification_outbox
  ADD COLUMN IF NOT EXISTS lease_token TEXT;

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_notification_outbox_lease
  ON oxsteed_credit_notification_outbox (id, lease_token)
  WHERE status = 'sending';
