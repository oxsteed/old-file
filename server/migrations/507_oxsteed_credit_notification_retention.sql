-- Migration 507: support bounded retention for successfully delivered Credit notifications.
-- Pending and failed rows remain available for retry, operations, and audit review.

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_notification_outbox_sent_retention
  ON oxsteed_credit_notification_outbox (sent_at, id)
  WHERE status = 'sent' AND sent_at IS NOT NULL;
