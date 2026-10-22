ALTER TABLE restaurant_reservations
  ADD COLUMN IF NOT EXISTS notification_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_claim_token TEXT;

CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_notification_claim
  ON restaurant_reservations(restaurant_id, id, notification_claimed_at)
  WHERE notified_at IS NULL;
