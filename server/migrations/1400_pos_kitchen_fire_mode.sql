-- Migration 1400: F-04 fire-on-pay kitchen ticket mode.
--
-- A per-store kitchen fire mode for the POS checkout:
--   'on_send' (default) — kitchen tickets fire when the order is created
--   'on_pay'            — kitchen tickets fire only after a payment lands.
-- NULL inherits the restaurant-level settings key
-- (kitchenFireMode / kitchen_fire_mode in food_restaurants.settings).
--
-- food_orders.kitchen_ticket_fired_at records when the kitchen ticket
-- actually fired (printer jobs enqueued). The KDS queue board only shows
-- fired tickets, so an unpaid on_pay ticket stays invisible to the
-- kitchen until the payment arrives. Backfilled to created_at for all
-- existing orders (they fired under the old always-on-send behavior).

ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS kitchen_fire_mode VARCHAR(16);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_kitchen_fire_mode_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_kitchen_fire_mode_valid
      CHECK (kitchen_fire_mode IS NULL OR kitchen_fire_mode IN ('on_send', 'on_pay'));
  END IF;
END $$;

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS kitchen_ticket_fired_at TIMESTAMPTZ;

UPDATE food_orders
   SET kitchen_ticket_fired_at = created_at
 WHERE kitchen_ticket_fired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_food_orders_kitchen_fired
  ON food_orders(restaurant_id, kitchen_ticket_fired_at)
  WHERE kitchen_ticket_fired_at IS NULL;
