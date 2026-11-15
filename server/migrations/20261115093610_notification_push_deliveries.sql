-- Migration: push delivery ledger (notifications audit N2)
--
-- Push delivery was deduped only by the notifications row
-- (is_push_sent), which is created only when in-app is enabled. A
-- retry re-fired push when in-app was off, because there was no row
-- to carry the flag and nothing else recorded the send. This ledger
-- records each push send by delivery key, independent of the in-app
-- row, so a retry skips push even when no notifications row exists.
-- Rows are keyed by delivery key (one row per push send); the user
-- reference cascades on user deletion, so erasure leaves no residue.

CREATE TABLE IF NOT EXISTS notification_push_deliveries (
  delivery_key      TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(100) NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_push_deliveries_user
  ON notification_push_deliveries(user_id);
