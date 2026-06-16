CREATE TABLE IF NOT EXISTS restaurant_pos_receipt_events (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  food_order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  queue_number INTEGER NOT NULL,
  guest_name VARCHAR(140),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  payment_status VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_receipt_events_restaurant_created
  ON restaurant_pos_receipt_events (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_receipt_events_order
  ON restaurant_pos_receipt_events (food_order_id, created_at DESC);
