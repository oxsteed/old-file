-- 986: Track guest reservation notifications without exposing contact data.
ALTER TABLE restaurant_reservations
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_notification
  ON restaurant_reservations(restaurant_id, location_id, status, notified_at);
