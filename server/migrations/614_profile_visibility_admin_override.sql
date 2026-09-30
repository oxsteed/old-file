-- Migration 614: admin public-visibility override for profiles.
--
-- Helpers, businesses, and restaurants each already carry their own public
-- visibility flag (helper_profiles.is_listed, businesses.is_listed,
-- food_restaurants.discovery_status), but those flags can be flipped back by
-- the profile owner, so they cannot be used for compliance holds. These
-- columns give admins a sticky override: when is_hidden_by_admin is TRUE the
-- public profile endpoints treat the profile as hidden no matter what the
-- owner-facing flag says. Only an admin with the manage_profile_visibility
-- grant can set or clear it, via the profile-visibility admin API.
--
-- hidden_reason is a short machine-readable code chosen by the admin
-- ('incomplete_profile', 'non_compliance', 'admin_decision'); the audit log
-- keeps the full human-readable note.

DO $$
BEGIN
  -- helper_profiles
  ALTER TABLE helper_profiles
    ADD COLUMN IF NOT EXISTS is_hidden_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hidden_reason      TEXT,
    ADD COLUMN IF NOT EXISTS hidden_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hidden_by          UUID;

  -- businesses
  ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS is_hidden_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hidden_reason      TEXT,
    ADD COLUMN IF NOT EXISTS hidden_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hidden_by          UUID;

  -- food_restaurants
  ALTER TABLE food_restaurants
    ADD COLUMN IF NOT EXISTS is_hidden_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hidden_reason      TEXT,
    ADD COLUMN IF NOT EXISTS hidden_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hidden_by          UUID;
END
$$;

-- Foreign keys to the admin who hid the profile (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_helper_profiles_hidden_by') THEN
    ALTER TABLE helper_profiles
      ADD CONSTRAINT fk_helper_profiles_hidden_by
      FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_businesses_hidden_by') THEN
    ALTER TABLE businesses
      ADD CONSTRAINT fk_businesses_hidden_by
      FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_food_restaurants_hidden_by') THEN
    ALTER TABLE food_restaurants
      ADD CONSTRAINT fk_food_restaurants_hidden_by
      FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- Partial indexes: only hidden profiles are ever looked up by this flag.
CREATE INDEX IF NOT EXISTS idx_helper_profiles_hidden_by_admin
  ON helper_profiles (is_hidden_by_admin) WHERE is_hidden_by_admin = TRUE;
CREATE INDEX IF NOT EXISTS idx_businesses_hidden_by_admin
  ON businesses (is_hidden_by_admin) WHERE is_hidden_by_admin = TRUE;
CREATE INDEX IF NOT EXISTS idx_food_restaurants_hidden_by_admin
  ON food_restaurants (is_hidden_by_admin) WHERE is_hidden_by_admin = TRUE;
