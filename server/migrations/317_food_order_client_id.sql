-- Migration 317: Idempotent offline order replay via clientOrderId in metadata.
-- Kiosk/POS/mobile clients generate a UUID per submission; replays return the
-- existing row instead of creating a duplicate ticket.

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_orders_client_order_id
  ON food_orders (restaurant_id, ((metadata->>'clientOrderId')))
  WHERE metadata->>'clientOrderId' IS NOT NULL AND metadata->>'clientOrderId' <> '';
