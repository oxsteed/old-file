-- Migration 509: targeted queue indexes for Credit notification operations.
-- Keep pending claims, stale-send recovery, and failed-delivery review fast as
-- the durable outbox grows; sent-row retention remains independently bounded.

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_notification_outbox_pending_due
  ON oxsteed_credit_notification_outbox (next_attempt_at, created_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_notification_outbox_sending_lock
  ON oxsteed_credit_notification_outbox (locked_at, created_at, id)
  WHERE status = 'sending';

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_notification_outbox_failed_history
  ON oxsteed_credit_notification_outbox (created_at DESC, id DESC)
  WHERE status = 'failed';
