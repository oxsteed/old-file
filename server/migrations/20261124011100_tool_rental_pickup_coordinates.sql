-- Group 11 item 564: pickup coordinates on tool rentals.
-- The browse code already probes for location_lat/location_lng and returns
-- them when present, but no migration ever added the columns and no write
-- path stored them, so a distance filter could never match. This adds them.
-- Additive only; safe to run twice.
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS location_lat NUMERIC(10,7);
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS location_lng NUMERIC(11,7);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_location_lat_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_location_lat_check
      CHECK (location_lat IS NULL OR (location_lat >= -90 AND location_lat <= 90));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_location_lng_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_location_lng_check
      CHECK (location_lng IS NULL OR (location_lng >= -180 AND location_lng <= 180));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_location_pair_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_location_pair_check
      CHECK ((location_lat IS NULL) = (location_lng IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tool_rentals_location ON tool_rentals(location_lat, location_lng);
