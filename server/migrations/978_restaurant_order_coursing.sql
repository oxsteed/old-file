-- Migration 978: persist the service course for each restaurant order line.
-- Existing tickets remain first-course tickets; POS clients may assign later
-- courses when they build a ticket.

ALTER TABLE food_order_items
  ADD COLUMN IF NOT EXISTS course_number INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'food_order_items'::regclass
       AND conname = 'food_order_items_course_number_check'
  ) THEN
    ALTER TABLE food_order_items
      ADD CONSTRAINT food_order_items_course_number_check
      CHECK (course_number BETWEEN 1 AND 20);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_order_items_order_course
  ON food_order_items(order_id, course_number, id);
