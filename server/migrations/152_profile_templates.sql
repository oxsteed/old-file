-- Migration 152: Profile Template System
-- Creates template_pricing, template_access tables
-- Adds active_template column to businesses and helper_profiles

-- ── Template pricing table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS template_pricing (
  id                    SERIAL PRIMARY KEY,
  slug                  VARCHAR(64)      NOT NULL UNIQUE,
  name                  VARCHAR(128)     NOT NULL,
  category              VARCHAR(64)      NOT NULL DEFAULT 'general',
  is_free               BOOLEAN          NOT NULL DEFAULT FALSE,
  monthly_price_cents   INTEGER          NOT NULL DEFAULT 0,
  lifetime_price_cents  INTEGER          NOT NULL DEFAULT 0,
  bundle_monthly_cents  INTEGER          NOT NULL DEFAULT 0,
  bundle_lifetime_cents INTEGER          NOT NULL DEFAULT 0,
  sort_order            INTEGER          NOT NULL DEFAULT 0,
  is_active             BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- ── Template access table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS template_access (
  id             BIGSERIAL    PRIMARY KEY,
  user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_slug  VARCHAR(64)  NOT NULL,
  access_type    VARCHAR(32)  NOT NULL DEFAULT 'purchase',
  -- access_type: 'purchase_monthly' | 'purchase_lifetime' | 'admin_grant' | 'bundle_monthly' | 'bundle_lifetime'
  grant_type     VARCHAR(16)  DEFAULT NULL,
  -- grant_type (admin grants only): 'timed' | 'permanent'
  granted_by     UUID         DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  internal_note  TEXT         DEFAULT NULL,
  start_date     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expiry_date    TIMESTAMPTZ  DEFAULT NULL,
  -- status: 'active' | 'expired' | 'revoked' | 'cancelled'
  status         VARCHAR(16)  NOT NULL DEFAULT 'active',
  stripe_sub_id  VARCHAR(128) DEFAULT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT template_access_type_check
    CHECK (access_type IN (
      'purchase_monthly','purchase_lifetime',
      'admin_grant','bundle_monthly','bundle_lifetime'
    )),
  CONSTRAINT template_access_grant_type_check
    CHECK (grant_type IS NULL OR grant_type IN ('timed','permanent')),
  CONSTRAINT template_access_status_check
    CHECK (status IN ('active','expired','revoked','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_template_access_user_id
  ON template_access(user_id);

CREATE INDEX IF NOT EXISTS idx_template_access_slug
  ON template_access(template_slug);

CREATE INDEX IF NOT EXISTS idx_template_access_user_slug_status
  ON template_access(user_id, template_slug, status);

CREATE INDEX IF NOT EXISTS idx_template_access_expiry
  ON template_access(expiry_date)
  WHERE status = 'active' AND expiry_date IS NOT NULL;

-- ── Add active_template column to businesses ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'active_template'
  ) THEN
    ALTER TABLE businesses ADD COLUMN active_template VARCHAR(64) NOT NULL DEFAULT 'default';
  END IF;
END
$$;

-- ── Add active_template column to helper_profiles ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'helper_profiles' AND column_name = 'active_template'
  ) THEN
    ALTER TABLE helper_profiles ADD COLUMN active_template VARCHAR(64) NOT NULL DEFAULT 'default';
  END IF;
END
$$;

-- ── Seed all 30 templates into template_pricing ─────────────────────────────
-- All templates: $0.99/month (99 cents), no lifetime option, 1-year free trial on signup
INSERT INTO template_pricing
  (slug, name, category, is_free, monthly_price_cents, lifetime_price_cents, sort_order)
VALUES
  -- Free
  ('default',             'Default',              'general',    TRUE,  0,    0,     1),
  -- Home & Property
  ('trades_pro',          'Trades Pro',           'home',       FALSE, 99,   0,     2),
  ('handyman',            'Handyman',             'home',       FALSE, 99,   0,     3),
  ('home_garden',         'Home & Garden',        'home',       FALSE, 99,   0,     4),
  ('cleaning_service',    'Cleaning Service',     'home',       FALSE, 99,   0,     5),
  ('pest_control',        'Pest Control',         'home',       FALSE, 99,   0,     6),
  ('moving_hauling',      'Moving & Hauling',     'home',       FALSE, 99,   0,     7),
  ('interior_design',     'Interior Design',      'home',       FALSE, 99,   0,     8),
  -- Creative & Media
  ('creative_studio',     'Creative Studio',      'creative',   FALSE, 99,   0,     9),
  ('graphic_design',      'Graphic Design',       'creative',   FALSE, 99,   0,    10),
  ('music_audio',         'Music & Audio',        'creative',   FALSE, 99,   0,    11),
  ('writing_copy',        'Writing & Copy',       'creative',   FALSE, 99,   0,    12),
  -- Health & Wellness
  ('fitness_pro',         'Fitness Pro',          'health',     FALSE, 99,   0,    13),
  ('wellness_therapy',    'Wellness & Therapy',   'health',     FALSE, 99,   0,    14),
  ('nutrition_diet',      'Nutrition & Diet',     'health',     FALSE, 99,   0,    15),
  ('mental_health',       'Mental Health',        'health',     FALSE, 99,   0,    16),
  -- Care & Education
  ('care_trust',          'Care & Trust',         'care',       FALSE, 99,   0,    17),
  ('pet_services',        'Pet Services',         'care',       FALSE, 99,   0,    18),
  ('tutoring_education',  'Tutoring & Education', 'care',       FALSE, 99,   0,    19),
  ('child_development',   'Child Development',    'care',       FALSE, 99,   0,    20),
  -- Events & Hospitality
  ('events_entertainment','Events & Entertainment','events',    FALSE, 99,   0,    21),
  ('catering_food',       'Catering & Food',      'events',     FALSE, 99,   0,    22),
  ('wedding_services',    'Wedding Services',     'events',     FALSE, 99,   0,    23),
  -- Beauty & Personal Care
  ('beauty_style',        'Beauty & Style',       'beauty',     FALSE, 99,   0,    24),
  ('barbershop',          'Barbershop',           'beauty',     FALSE, 99,   0,    25),
  ('spa_skincare',        'Spa & Skincare',       'beauty',     FALSE, 99,   0,    26),
  -- Tech & Professional
  ('tech_it',             'Tech & IT',            'tech',       FALSE, 99,   0,    27),
  ('web_app_dev',         'Web & App Dev',        'tech',       FALSE, 99,   0,    28),
  ('consulting_coaching', 'Consulting & Coaching','tech',       FALSE, 99,   0,    29),
  ('legal_admin',         'Legal & Administrative','tech',      FALSE, 99,   0,    30)
ON CONFLICT (slug) DO NOTHING;
