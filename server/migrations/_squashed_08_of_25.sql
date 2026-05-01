
-- >>> BEGIN: 054_helper_products.sql <<<
-- Migration 054: Helper Products
-- Helpers can list products (food, supplies, gear, other) on their profile.
-- OxSteed plays no verification role — self-declared, same as tools.

CREATE TABLE IF NOT EXISTS helper_products (
  id           SERIAL PRIMARY KEY,
  helper_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL CHECK (price_cents > 0),
  category     VARCHAR(50) NOT NULL DEFAULT 'food'
                 CHECK (category IN ('food', 'supply', 'gear', 'other')),
  image_url    TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_helper_products_helper ON helper_products(helper_id);
CREATE INDEX IF NOT EXISTS idx_helper_products_category ON helper_products(category);
CREATE INDEX IF NOT EXISTS idx_helper_products_available ON helper_products(helper_id, is_available);

-- Also add food skills and licenses to skills_lookup
INSERT INTO skills_lookup (name, category) VALUES
  ('Food Delivery',                  'Food & Beverage'),
  ('Meal Prep & Delivery',           'Food & Beverage'),
  ('Home-Cooked Meal Service',       'Food & Beverage'),
  ('Catering (Small Events)',        'Food & Beverage'),
  ('Grocery & Errand Delivery',      'Food & Beverage'),
  ('Baked Goods Delivery',           'Food & Beverage'),
  ('Beverage & Drinks Delivery',     'Food & Beverage')
ON CONFLICT (name) DO NOTHING;

-- >>> END: 054_helper_products.sql <<<

-- >>> BEGIN: 055_security_schema_fixes.sql <<<
-- Migration 055: Security schema fixes
-- Addresses findings M-56, M-59 from the security audit

-- ── M-59: Add indexes on OTP expiry columns for fast cleanup queries ─────────
-- Without these, a cron job cleaning up expired OTPs does a full-table scan.
CREATE INDEX IF NOT EXISTS idx_pending_registrations_otp_expires
  ON pending_registrations (otp_expires_at)
  WHERE otp_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_expires
  ON users (reset_token_expires)
  WHERE reset_token_expires IS NOT NULL;

-- ── M-59: Add index on sessions.expires_at for fast token cleanup ─────────────
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions (expires_at)
  WHERE expires_at IS NOT NULL;

-- ── M-56: Add NOT NULL constraint on admin_audit_log.admin_id ─────────────────
-- Some legacy rows may have NULL admin_id from migration 005. Backfill with a
-- sentinel UUID before applying the constraint.
DO $$
BEGIN
  -- Only run if the column exists without a NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'admin_audit_log'
      AND column_name  = 'admin_id'
      AND is_nullable  = 'YES'
  ) THEN
    -- Backfill NULLs with a zero UUID sentinel (indicates system/migration action)
    UPDATE admin_audit_log
    SET admin_id = '00000000-0000-0000-0000-000000000000'
    WHERE admin_id IS NULL;

    -- Now safe to add NOT NULL
    ALTER TABLE admin_audit_log
      ALTER COLUMN admin_id SET NOT NULL;
  END IF;
END $$;

-- ── Index on admin_audit_log for faster per-admin activity queries ────────────
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id
  ON admin_audit_log (admin_id, created_at DESC);

-- >>> END: 055_security_schema_fixes.sql <<<

-- >>> BEGIN: 056_role_switching_and_helper_listing.sql <<<
-- Migration 056: Role switching support + helper listing visibility toggle
-- Adds is_listed column to helper_profiles so helpers can go "offline"
-- without deactivating their account.

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT TRUE;

-- Partial index — only listed helpers need to be fast-scanned in directory queries
CREATE INDEX IF NOT EXISTS idx_helper_profiles_is_listed
  ON helper_profiles (user_id)
  WHERE is_listed = TRUE;

-- >>> END: 056_role_switching_and_helper_listing.sql <<<

-- >>> BEGIN: 057_user_vehicles.sql <<<
-- Migration 057: User Vehicles
-- Stores vehicles registered by users for Car Care planned needs.
-- Data sourced from NHTSA vPIC API (free, no key required).
-- OxSteed v2

CREATE TABLE IF NOT EXISTS user_vehicles (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make_id     INTEGER      NOT NULL,          -- NHTSA Make_ID
  make_name   VARCHAR(80)  NOT NULL,          -- e.g. "Toyota"
  model_id    INTEGER      NOT NULL,          -- NHTSA Model_ID
  model_name  VARCHAR(120) NOT NULL,          -- e.g. "Camry"
  year        SMALLINT,                       -- optional, user-entered
  nickname    VARCHAR(80),                    -- optional label, e.g. "My Commuter"
  notes       TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_vehicles_user ON user_vehicles (user_id);

-- Prevent duplicate same make+model+year per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_vehicles_per_user
  ON user_vehicles (user_id, make_id, model_id, COALESCE(year, 0));

-- Auto-update updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_vehicles_updated_at') THEN
    CREATE TRIGGER trg_user_vehicles_updated_at
      BEFORE UPDATE ON user_vehicles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- >>> END: 057_user_vehicles.sql <<<

-- >>> BEGIN: 058_user_homes.sql <<<
-- Migration 058: User Homes
-- Home profiles enriched from Census + OSM + FEMA lookups.
-- OxSteed v2

CREATE TABLE IF NOT EXISTS user_homes (
  id                    BIGSERIAL    PRIMARY KEY,
  user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Address (from Census geocoder — confirmed, standardised)
  address               VARCHAR(300) NOT NULL,
  city                  VARCHAR(80),
  state                 VARCHAR(20),
  zip                   VARCHAR(20),
  lat                   NUMERIC(10,7),
  lng                   NUMERIC(10,7),

  -- User-provided details
  nickname              VARCHAR(80),
  home_type             VARCHAR(50),   -- 'house' | 'condo' | 'townhouse' | 'mobile' | 'other'
  year_built            SMALLINT,
  sqft                  INTEGER,
  bedrooms              SMALLINT,
  bathrooms             NUMERIC(3,1),
  notes                 TEXT,

  -- Auto-populated from public APIs
  flood_zone            VARCHAR(20),   -- from FEMA NFHL
  osm_building_levels   SMALLINT,      -- from OpenStreetMap

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_homes_user ON user_homes (user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_homes_updated_at') THEN
    CREATE TRIGGER trg_user_homes_updated_at
      BEFORE UPDATE ON user_homes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- >>> END: 058_user_homes.sql <<<

-- >>> BEGIN: 059_add_helper_availability.sql <<<
-- Migration 059: Add helper availability timestamp for live chat
-- NOTE: helper_profiles already has is_available_now BOOLEAN (added in 019_helper_registration.sql)
-- This migration only adds the missing available_since timestamp column
-- and a partial index to speed up browse filtering.

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS available_since TIMESTAMPTZ;

-- Partial index for fast filtering of available helpers on browse/search page
-- Only indexes rows where is_available_now = true (small subset = lean index)
CREATE INDEX IF NOT EXISTS idx_helper_profiles_is_available_now
  ON helper_profiles (is_available_now)
  WHERE is_available_now = true;

-- >>> END: 059_add_helper_availability.sql <<<

-- >>> BEGIN: 060_conversations_null_job_unique.sql <<<
-- Migration 060: Enforce uniqueness for job-less conversations
--
-- PostgreSQL UNIQUE(job_id, customer_id, helper_id) in migration 024 does NOT
-- prevent duplicates when job_id IS NULL because NULL != NULL in unique
-- constraint evaluation.  A partial unique index fills this gap.
--
-- This index ensures that for a given (customer, helper) pair, at most one
-- conversation can exist without a job_id.  ON CONFLICT DO NOTHING in the
-- getOrCreateConversation and profileChatMessage controllers handles the race.

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_null_job_unique
  ON conversations (customer_id, helper_id)
  WHERE job_id IS NULL;

-- >>> END: 060_conversations_null_job_unique.sql <<<
