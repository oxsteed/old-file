-- Migration 052: Helper profile content tables
-- Adds helper_services, helper_faqs, helper_policies, helper_gallery
-- so helpers can fully complete their public-facing profile.
-- Also adds cover_photo_url and response_rate to helper_profiles.
-- OxSteed

-- ── cover photo + response rate on helper_profiles ────────────────────────────
ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS cover_photo_url     TEXT,
  ADD COLUMN IF NOT EXISTS response_rate       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profile_headline    VARCHAR(280);

-- ── helper_services ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS helper_services (
  id           SERIAL       PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_helper_services_user ON helper_services(user_id);

-- ── helper_faqs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS helper_faqs (
  id          SERIAL       PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question    VARCHAR(280) NOT NULL,
  answer      TEXT         NOT NULL,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_helper_faqs_user ON helper_faqs(user_id);

-- ── helper_policies ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS helper_policies (
  id          SERIAL       PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(140) NOT NULL,
  content     TEXT         NOT NULL,
  icon        VARCHAR(40)  NOT NULL DEFAULT 'file-text',
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_helper_policies_user ON helper_policies(user_id);

-- ── helper_gallery ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS helper_gallery (
  id          SERIAL       PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT         NOT NULL,
  caption     VARCHAR(200),
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_helper_gallery_user ON helper_gallery(user_id);
