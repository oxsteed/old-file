-- Migration 286: Growth programs + community wholesale listings
-- These power the iOS Growth tab Programs and Wholesale sections.

-- ── Growth Programs ──────────────────────────────────────────────────────────
-- icon_name  : SF Symbol name (iOS) or Lucide icon name (web)
-- color_key  : one of accent | money | home | car | personal | goals | sinking | success | warning | danger
-- cta_type   : external (open URL in browser) | tab_learn | tab_life | tab_home | tab_growth
-- persona_filter : NULL = show to all; otherwise ARRAY of persona strings

CREATE TABLE IF NOT EXISTS growth_programs (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200)  NOT NULL,
  subtitle      TEXT,
  icon_name     VARCHAR(100)  NOT NULL DEFAULT 'checkmark.seal.fill',
  color_key     VARCHAR(40)   NOT NULL DEFAULT 'accent',
  cta_label     VARCHAR(80)   NOT NULL DEFAULT 'Learn more',
  cta_url       TEXT,
  cta_type      VARCHAR(30)   NOT NULL DEFAULT 'external',
  persona_filter TEXT[],
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order    INT           NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_programs_active
  ON growth_programs (is_active, sort_order);

-- ── Community Wholesale Listings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wholesale_listings (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200)  NOT NULL,
  subtitle      TEXT,
  icon_name     VARCHAR(100)  NOT NULL DEFAULT 'shippingbox.fill',
  save_percent  NUMERIC(5,1),
  joined_count  INT           NOT NULL DEFAULT 0,
  category      VARCHAR(100),
  external_url  TEXT,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order    INT           NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wholesale_listings_active
  ON wholesale_listings (is_active, sort_order);

-- ── Wholesale joins (one row per user per listing, drives joined_count) ──────
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO user_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'users'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS wholesale_joins (
      user_id    %1$s       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id INT        NOT NULL REFERENCES wholesale_listings(id) ON DELETE CASCADE,
      joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, listing_id)
    )
  $sql$, user_id_type);
END $$;

-- ── Seed: Programs ────────────────────────────────────────────────────────────
INSERT INTO growth_programs (title, subtitle, icon_name, color_key, cta_label, cta_url, cta_type, persona_filter, sort_order)
VALUES
  (
    'Business Ascension',
    'Side income → licensed business in 6 weeks',
    'checkmark.seal.fill',
    'accent',
    'Apply',
    'https://oxsteed.com/programs/business-ascension',
    'external',
    ARRAY['helper', 'business'],
    10
  ),
  (
    'Micro-loan pre-qualify',
    'Up to $5,000 for tools and equipment',
    'creditcard.fill',
    'money',
    'Check',
    'https://oxsteed.com/programs/micro-loan',
    'external',
    NULL,
    20
  ),
  (
    'Local grants',
    'Matched grants for your trade and location',
    'gift.fill',
    'goals',
    'View',
    'https://oxsteed.com/programs/grants',
    'external',
    NULL,
    30
  )
ON CONFLICT DO NOTHING;

-- ── Seed: Wholesale ───────────────────────────────────────────────────────────
INSERT INTO wholesale_listings (title, subtitle, icon_name, save_percent, joined_count, category, external_url, sort_order)
VALUES
  (
    'Pressure washer bundle',
    'Commercial grade 3200 PSI kit with hoses and surface cleaner',
    'shippingbox.fill',
    22.0,
    14,
    'equipment',
    'https://oxsteed.com/wholesale/pressure-washer',
    10
  ),
  (
    'Commercial cleaning supplies',
    'Industrial-grade concentrates — bulk pricing for helpers and businesses',
    'shippingbox.fill',
    18.0,
    9,
    'supplies',
    'https://oxsteed.com/wholesale/cleaning-supplies',
    20
  )
ON CONFLICT DO NOTHING;
