-- Migration 885: tag admin_regions with an ISO-2 country code.
--
-- Regions are custom geographic boundaries (zip ranges, city/state lists,
-- geo-radius). Tagging them with a country lets assignment UIs offer only
-- the regions relevant to the selected country. NULL = global (usable
-- with any country, preserving existing behavior).

ALTER TABLE admin_regions
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);

-- Keep values clean: 2 uppercase letters or NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_regions_country_code_fmt'
  ) THEN
    ALTER TABLE admin_regions
      ADD CONSTRAINT admin_regions_country_code_fmt
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_regions_country_code
  ON admin_regions(country_code);
