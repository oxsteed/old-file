-- Durable delivery marker for follow-up reminders.
-- A reminder remains pending until an agent completes or cancels it, while this
-- marker prevents the worker from notifying staff on every polling interval.
ALTER TABLE support_follow_up_reminders
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_support_follow_up_reminders_due_unnotified
  ON support_follow_up_reminders (due_at, notified_at)
  WHERE status = 'pending';
