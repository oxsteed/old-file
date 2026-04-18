-- Migration 075: Business Independence Redesign — Phase 1
-- Move services, gallery, policies, FAQs, and hours from helper_profiles to business level
-- This makes each business fully independent with its own complete profile.

-- ── 1. Extend businesses table with profile fields ─────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS description        VARCHAR(500),
  ADD COLUMN IF NOT EXISTS profile_headline   VARCHAR(280),
  ADD COLUMN IF NOT EXISTS logo_url           VARCHAR(500),
  ADD COLUMN IF NOT EXISTS cover_photo_url    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS color_scheme_primary   VARCHAR(7),  -- hex color, e.g. #F4A261
  ADD COLUMN IF NOT EXISTS color_scheme_secondary VARCHAR(7),
  ADD COLUMN IF NOT EXISTS service_radius_miles   INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS availability_json     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS industry_category  VARCHAR(50),  -- future: 'service', 'salon', 'restaurant', etc.
  ADD COLUMN IF NOT EXISTS response_rate      INTEGER NOT NULL DEFAULT 0;

-- ── 2. Create business_services table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_services (
  id           SERIAL       PRIMARY KEY,
  business_id  INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         VARCHAR(140) NOT NULL,
  description  TEXT,
  price        DECIMAL(10,2) NOT NULL DEFAULT 0,
  price_unit   VARCHAR(20)  NOT NULL DEFAULT 'flat'
                            CHECK (price_unit IN ('flat','hour','starting_at','quote')),
  duration     VARCHAR(60),
  popular      BOOLEAN      NOT NULL DEFAULT false,
  category     VARCHAR(80)  NOT NULL DEFAULT 'General',
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_services_business ON business_services(business_id);

-- ── 3. Create business_faqs table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_faqs (
  id          SERIAL       PRIMARY KEY,
  business_id INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question    VARCHAR(280) NOT NULL,
  answer      TEXT         NOT NULL,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_faqs_business ON business_faqs(business_id);

-- ── 4. Create business_policies table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_policies (
  id          SERIAL       PRIMARY KEY,
  business_id INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title       VARCHAR(140) NOT NULL,
  content     TEXT         NOT NULL,
  icon        VARCHAR(40)  NOT NULL DEFAULT 'file-text',
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_policies_business ON business_policies(business_id);

-- ── 5. Create business_gallery table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_gallery (
  id          SERIAL       PRIMARY KEY,
  business_id INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url         TEXT         NOT NULL,
  caption     VARCHAR(200),
  alt         VARCHAR(200),
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_gallery_business ON business_gallery(business_id);

-- ── 6. Create business_hours table (structured) ──────────────────────────────
CREATE TABLE IF NOT EXISTS business_hours (
  id          SERIAL       PRIMARY KEY,
  business_id INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week INTEGER      NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday, 6=Saturday
  start_time  TIME,
  end_time    TIME,
  is_closed   BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (business_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_business_hours_business ON business_hours(business_id);

-- ── 7. Backwards compatibility: Mark helper content tables as "legacy" ────────
-- These will be deprecated after migration but kept for rollback safety
ALTER TABLE helper_services
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE helper_faqs
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE helper_policies
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE helper_gallery
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT false;

-- ── 8. Migration helper function: Copy helper data to primary business ────────
-- This function is called by the application layer after all tables are created.
-- It ensures data consistency and allows for safe rollback if needed.
CREATE OR REPLACE FUNCTION migrate_helper_to_business_content() RETURNS void AS $$
DECLARE
  v_helper_user_id UUID;
  v_business_id INTEGER;
BEGIN
  -- For each helper user, if they have a primary business, copy their profile content
  FOR v_helper_user_id, v_business_id IN
    SELECT u.id, b.id
    FROM users u
    JOIN businesses b ON b.user_id = u.id AND b.is_primary = TRUE
    WHERE u.role IN ('helper', 'helper_pro', 'broker')
  LOOP
    -- Copy profile headline and description
    UPDATE businesses
    SET
      profile_headline = COALESCE(profile_headline, hp.profile_headline),
      description = COALESCE(description, hp.bio_long),
      cover_photo_url = COALESCE(cover_photo_url, hp.cover_photo_url),
      service_radius_miles = COALESCE(NULLIF(service_radius_miles, 10), hp.service_radius_miles),
      availability_json = COALESCE(NULLIF(availability_json, '{}'), hp.availability_json),
      response_rate = COALESCE(NULLIF(response_rate, 0), hp.response_rate),
      updated_at = NOW()
    FROM helper_profiles hp
    WHERE hp.user_id = v_helper_user_id
      AND businesses.id = v_business_id;

    -- Copy services
    INSERT INTO business_services (business_id, name, description, price, price_unit, duration, popular, category, sort_order, is_active)
    SELECT v_business_id, name, description, price, price_unit, duration, popular, category, sort_order, is_active
    FROM helper_services
    WHERE user_id = v_helper_user_id;

    -- Copy FAQs
    INSERT INTO business_faqs (business_id, question, answer, sort_order)
    SELECT v_business_id, question, answer, sort_order
    FROM helper_faqs
    WHERE user_id = v_helper_user_id;

    -- Copy policies
    INSERT INTO business_policies (business_id, title, content, icon, sort_order)
    SELECT v_business_id, title, content, icon, sort_order
    FROM helper_policies
    WHERE user_id = v_helper_user_id;

    -- Copy gallery
    INSERT INTO business_gallery (business_id, url, caption, alt, sort_order)
    SELECT v_business_id, url, caption, '', sort_order
    FROM helper_gallery
    WHERE user_id = v_helper_user_id;

  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ── 9. Mark old tables as legacy (data is preserved, not deleted) ──────────────
COMMENT ON TABLE helper_services IS 'LEGACY: Use business_services instead. Kept for backwards compatibility.';
COMMENT ON TABLE helper_faqs IS 'LEGACY: Use business_faqs instead. Kept for backwards compatibility.';
COMMENT ON TABLE helper_policies IS 'LEGACY: Use business_policies instead. Kept for backwards compatibility.';
COMMENT ON TABLE helper_gallery IS 'LEGACY: Use business_gallery instead. Kept for backwards compatibility.';

-- ── 10. Add missing columns to helper_profiles for backwards compat ──────────
-- Support reading old profile data during transition period
ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS primary_business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_helper_profiles_primary_business
  ON helper_profiles(primary_business_id);

COMMIT;
