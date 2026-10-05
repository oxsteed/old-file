-- Migration 679: promotional flag on notifications for the promo frequency governor.
--
-- notificationService.sendNotification accepts promotional: true for marketing
-- content. The governor caps promotional pushes at 2 per user per rolling
-- 7 days; transactional notifications (bids, orders, payouts, recovery)
-- are exempt. This column records the classification at insert time so the
-- cap query stays a cheap indexed count.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_promotional BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_promo_cap
  ON notifications (user_id, created_at DESC)
  WHERE is_promotional = TRUE;
