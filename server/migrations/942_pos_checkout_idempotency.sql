-- Migration 942: POS checkout idempotency (franchise review F-04).
--
-- The web POS creates the order and records the payment in two requests.
-- The client now generates one stable client_order_id per checkout attempt
-- and sends it on order creation; createPosOrder replays on it instead of
-- inserting a duplicate ticket when the payment step is retried. The value
-- was previously only kept inside food_orders.metadata; promoting it to a
-- column lets a partial unique index enforce one order per checkout per
-- restaurant. Existing rows keep NULL (the index ignores them), so
-- historical duplicates are untouched.
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS client_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_orders_restaurant_client_order
  ON food_orders (restaurant_id, client_order_id)
  WHERE client_order_id IS NOT NULL;
