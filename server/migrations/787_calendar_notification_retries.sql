-- P3-852: make failed calendar notifications retryable and visible to operators.
ALTER TABLE calendar_notifications
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

UPDATE calendar_notifications
   SET next_attempt_at = COALESCE(next_attempt_at, scheduled_send_at)
 WHERE next_attempt_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cal_notif_retry_due
  ON calendar_notifications (status, next_attempt_at, attempts)
  WHERE status IN ('pending', 'failed');
