-- 965: Store-level pricing policy. NULL means inherit the restaurant brand
-- rate, preserving existing single-store behavior while allowing franchises
-- to model local jurisdictions independently.
ALTER TABLE restaurant_locations
  ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER,
  ADD COLUMN IF NOT EXISTS service_fee_bps INTEGER,
  ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_jurisdiction VARCHAR(160);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_tax_rate_bps_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_tax_rate_bps_valid
      CHECK (tax_rate_bps IS NULL OR tax_rate_bps BETWEEN 0 AND 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_locations_service_fee_bps_valid') THEN
    ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_service_fee_bps_valid
      CHECK (service_fee_bps IS NULL OR service_fee_bps BETWEEN 0 AND 10000);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_restaurant_locations_tax_policy
  ON restaurant_locations(restaurant_id, id, tax_rate_bps, service_fee_bps);
