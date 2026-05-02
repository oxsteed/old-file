-- Allow users to pause auto-publish / reminders without cancelling the need
ALTER TABLE planned_needs
  ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_planned_needs_user_active
  ON planned_needs(user_id, status)
  WHERE status IN ('planned', 'funding', 'activating_soon') AND COALESCE(is_paused, FALSE) = FALSE;
