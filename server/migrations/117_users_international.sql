-- 117_users_international.sql
-- Make the users table country-aware so the app can serve customers in any
-- region — not just the United States.
--
-- Changes:
--   1. Add `users.country` (ISO-3166 alpha-2). Default 'US' so existing rows
--      remain valid for backwards compatibility.
--   2. Widen `users.state` from VARCHAR(50) → VARCHAR(100) to fit longer
--      state/province/region names (e.g. "Provence-Alpes-Côte d'Azur").
--   3. Widen `users.zip_code` from VARCHAR(10) → VARCHAR(20) to fit non-US
--      postal codes (e.g. UK "SW1A 1AA", Canadian "M5V 3L9").
--   4. Add optional `users.preferred_currency` (ISO-4217) and `users.timezone`
--      (IANA tz database name).
--
-- Idempotent: every statement uses IF NOT EXISTS where supported, and the
-- ALTER COLUMN TYPE statements are safe to re-run.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'US';

CREATE INDEX IF NOT EXISTS idx_users_country ON users (country);

-- Backfill any rows that ended up with NULL country before the default kicked
-- in (defensive — shouldn't happen with NOT NULL DEFAULT).
UPDATE users SET country = 'US' WHERE country IS NULL OR country = '';

-- Widen state column. Existing data fits trivially.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'state'
       AND character_maximum_length < 100
  ) THEN
    ALTER TABLE users ALTER COLUMN state TYPE VARCHAR(100);
  END IF;
END $$;

-- Widen zip_code column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'zip_code'
       AND character_maximum_length < 20
  ) THEN
    ALTER TABLE users ALTER COLUMN zip_code TYPE VARCHAR(20);
  END IF;
END $$;

-- Optional locale columns.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS timezone           VARCHAR(64);

-- ----------------------------------------------------------------
-- pending_registrations: signup buffer needs to carry the same
-- international fields, otherwise non-US signups get truncated.
-- ----------------------------------------------------------------
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NOT NULL DEFAULT 'US';

-- Widen pending_registrations.state (CHAR(2) / VARCHAR(2) historically).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'pending_registrations' AND column_name = 'state'
       AND character_maximum_length < 100
  ) THEN
    ALTER TABLE pending_registrations ALTER COLUMN state TYPE VARCHAR(100);
  END IF;
END $$;

-- Widen pending_registrations.zip_code (VARCHAR(10) historically).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'pending_registrations' AND column_name = 'zip_code'
       AND character_maximum_length < 20
  ) THEN
    ALTER TABLE pending_registrations ALTER COLUMN zip_code TYPE VARCHAR(20);
  END IF;
END $$;

-- Document the new columns.
COMMENT ON COLUMN users.country            IS 'ISO-3166 alpha-2 country code. Default ''US''.';
COMMENT ON COLUMN users.preferred_currency IS 'ISO-4217 currency code (e.g. USD, EUR, GBP).';
COMMENT ON COLUMN users.timezone           IS 'IANA timezone (e.g. America/New_York). Optional.';

COMMIT;
