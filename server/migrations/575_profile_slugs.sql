-- 575_profile_slugs.sql
-- Vanity profile slugs for helpers and businesses (customizable public profile URLs).
-- Slugs are validated app-side; the CHECK below enforces the canonical shape as a backstop.
-- Uniqueness is case-insensitive via CITEXT so "Mike" and "mike" cannot coexist.

CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS profile_slug CITEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS profile_slug_updated_at TIMESTAMPTZ;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS profile_slug CITEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS profile_slug_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'helper_profiles_profile_slug_format'
  ) THEN
    ALTER TABLE helper_profiles
      ADD CONSTRAINT helper_profiles_profile_slug_format
      CHECK (profile_slug IS NULL OR profile_slug::text ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_profile_slug_format'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_profile_slug_format
      CHECK (profile_slug IS NULL OR profile_slug::text ~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_helper_profiles_profile_slug
  ON helper_profiles (profile_slug) WHERE profile_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_profile_slug
  ON businesses (profile_slug) WHERE profile_slug IS NOT NULL;
