
-- >>> BEGIN: 073_invoice_public_tokens.sql <<<
-- Migration 073: Invoice Public Tokens for External Access
-- Adds public_token UUID to business_invoices for secure public viewing
-- and enables dual-track delivery (internal notifications + public links).

ALTER TABLE business_invoices
  ADD COLUMN IF NOT EXISTS public_token UUID UNIQUE;

-- Index for fast lookups by public token
CREATE INDEX IF NOT EXISTS idx_business_invoices_public_token
  ON business_invoices (public_token)
  WHERE public_token IS NOT NULL;

-- >>> END: 073_invoice_public_tokens.sql <<<

-- >>> BEGIN: 073b_tool_favorites.sql <<<
-- User tool favorites (wishlist)
CREATE TABLE IF NOT EXISTS user_tool_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tool_favorites_user_id
  ON user_tool_favorites(user_id);

CREATE INDEX IF NOT EXISTS idx_user_tool_favorites_tool_id
  ON user_tool_favorites(tool_id);

-- >>> END: 073b_tool_favorites.sql <<<

-- >>> BEGIN: 074_helper_scoped_invoices.sql <<<
-- Migration 074: Support Helper-Scoped Invoices
-- Makes business_id nullable so invoices can be helper-scoped (no business)
-- When business_id IS NULL, the invoice belongs to the helper user only

ALTER TABLE business_invoices
  ALTER COLUMN business_id DROP NOT NULL;

-- Update constraint to allow NULL business_id
ALTER TABLE business_invoices
  DROP CONSTRAINT business_invoices_business_id_fkey,
  ADD CONSTRAINT business_invoices_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

-- Update indexes to handle helper-scoped invoices (business_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_business_invoices_user_id
  ON business_invoices(user_id)
  WHERE business_id IS NULL;

-- Constraint: invoice must be scoped to either a business OR be helper-scoped
-- (but not both - if it has a business_id, that business must belong to the user)

-- >>> END: 074_helper_scoped_invoices.sql <<<

-- >>> BEGIN: 074b_tool_reviews.sql <<<
-- Tool reviews and ratings
CREATE TABLE tool_reviews (
  id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tool_id, user_id)
);

CREATE INDEX idx_tool_reviews_tool_id ON tool_reviews(tool_id);
CREATE INDEX idx_tool_reviews_user_id ON tool_reviews(user_id);

-- >>> END: 074b_tool_reviews.sql <<<

-- >>> BEGIN: 075_business_independence_phase1.sql <<<
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

-- >>> END: 075_business_independence_phase1.sql <<<

-- >>> BEGIN: 075_credential_removals.sql <<<
-- Credential removal tracking for self-reported credentials
-- Supports removal of licenses, insurance with audit trail

CREATE TABLE helper_credential_removals (
  id SERIAL PRIMARY KEY,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_type VARCHAR(50) NOT NULL CHECK (credential_type IN ('license', 'insurance')),
  removal_reason VARCHAR(255) NOT NULL CHECK (removal_reason IN (
    'unverified', 'expired', 'false_claim', 'user_report', 'other'
  )),
  notes TEXT,
  removed_by_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  removed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_helper_credential_removals_helper ON helper_credential_removals(helper_id);
CREATE INDEX idx_helper_credential_removals_type ON helper_credential_removals(credential_type);
CREATE INDEX idx_helper_credential_removals_removed_at ON helper_credential_removals(removed_at DESC);

-- >>> END: 075_credential_removals.sql <<<
