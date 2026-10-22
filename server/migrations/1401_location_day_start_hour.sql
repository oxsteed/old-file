-- Migration 1401: F-07 configurable day-start hour per store.
--
-- The sales report defines the business day in each store's local
-- timezone; day_start_hour shifts the day boundary (a store closing at
-- 2 AM attributes late-night sales to the previous business day).
-- Default 00:00 local: midnight boundary, unchanged behavior.

ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS day_start_hour INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_day_start_hour_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_day_start_hour_valid
      CHECK (day_start_hour BETWEEN 0 AND 23);
  END IF;
END $$;
