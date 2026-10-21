-- Migration 979: persist an optional seat assignment for each order line.
-- Seat numbers are scoped to the ticket and intentionally remain optional for
-- counter, pickup, and legacy orders.

ALTER TABLE food_order_items
  ADD COLUMN IF NOT EXISTS seat_number INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'food_order_items'::regclass
       AND conname = 'food_order_items_seat_number_check'
  ) THEN
    ALTER TABLE food_order_items
      ADD CONSTRAINT food_order_items_seat_number_check
      CHECK (seat_number IS NULL OR seat_number BETWEEN 1 AND 99);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_order_items_order_seat
  ON food_order_items(order_id, seat_number, id);
