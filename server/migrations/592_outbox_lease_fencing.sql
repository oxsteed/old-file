-- Migration 592: fence stale outbox workers.
-- A worker must present the lease token it received when claiming a row before
-- it can mark the row complete. This prevents a timed-out worker from
-- overwriting the result of a later retry.

ALTER TABLE message_notification_outbox
  ADD COLUMN IF NOT EXISTS lease_token TEXT;

ALTER TABLE support_email_outbox
  ADD COLUMN IF NOT EXISTS lease_token TEXT;

CREATE INDEX IF NOT EXISTS idx_message_notification_outbox_lease
  ON message_notification_outbox (id, lease_token)
  WHERE status = 'sending';

CREATE INDEX IF NOT EXISTS idx_support_email_outbox_lease
  ON support_email_outbox (id, lease_token)
  WHERE status = 'sending';
