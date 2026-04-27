-- 118_businesses_international.sql
-- Make business addresses internationally viable.
--
-- - Adds `address_country` (ISO-2). Defaults to 'US' so existing rows continue
--   to behave as before.
-- - Widens `address_state` (was VARCHAR(50)) and `address_zip` (was VARCHAR(10))
--   so non-US regions and postal formats fit (e.g. UK postcodes, Brazilian
--   region names, free-text regions).
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS address_country VARCHAR(2);

UPDATE businesses
  SET address_country = 'US'
  WHERE address_country IS NULL;

ALTER TABLE businesses
  ALTER COLUMN address_country SET DEFAULT 'US',
  ALTER COLUMN address_country SET NOT NULL;

ALTER TABLE businesses
  ALTER COLUMN address_state TYPE VARCHAR(100),
  ALTER COLUMN address_zip   TYPE VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_businesses_address_country
  ON businesses (address_country);

COMMIT;
