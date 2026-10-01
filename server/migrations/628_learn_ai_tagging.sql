-- Migration 628: Learn marketplace Phase 2 — AI tagging pipeline
--
-- learn_guide_ai_suggestions: OpenRouter-generated tool/material/service
-- suggestions per guide. All rows start as 'pending' and only reach the
-- public catalog after an admin approves them (fail-closed review queue).
--
-- learn_marketplace_clicks: raw click events for the Learn marketplace
-- funnel (rent / buy / direct / quote / helper actions per guide).

CREATE TABLE IF NOT EXISTS learn_guide_ai_suggestions (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id             TEXT         NOT NULL REFERENCES learn_guides(id) ON DELETE CASCADE,
  kind                 TEXT         NOT NULL
                       CHECK (kind IN ('tool', 'material', 'service')),
  name                 TEXT         NOT NULL,
  detail               TEXT,
  suggested_rent_url   TEXT,
  suggested_buy_url    TEXT,
  matched_rental_slug  TEXT,
  matched_direct_category TEXT,
  confidence           NUMERIC(4, 3),
  status               TEXT         NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected')),
  raw_json             JSONB,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_at          TIMESTAMPTZ,
  reviewed_by          UUID         REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lgai_guide_status
  ON learn_guide_ai_suggestions (guide_id, status);

CREATE INDEX IF NOT EXISTS idx_lgai_status_created
  ON learn_guide_ai_suggestions (status, created_at DESC);

-- One pending suggestion per guide/kind/name; re-tags dedupe against it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lgai_pending_dedupe
  ON learn_guide_ai_suggestions (guide_id, kind, LOWER(name))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS learn_marketplace_clicks (
  id         BIGSERIAL    PRIMARY KEY,
  guide_id   TEXT         NOT NULL REFERENCES learn_guides(id) ON DELETE CASCADE,
  kind       TEXT         NOT NULL
             CHECK (kind IN ('rent', 'buy', 'direct', 'quote', 'helper')),
  target     TEXT,
  user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lmc_guide_created
  ON learn_marketplace_clicks (guide_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lmc_created
  ON learn_marketplace_clicks (created_at DESC);
