-- OxSteed Careers, Phase 4: AI audit trail, fairness reports and the
-- per-market AI-ranking gate (careers spec §6.11, §6.13, §10.4, §12.2).
--
-- career_ai_runs holds hashes and structured outputs, never applicant
-- names, photos, postal codes, ratings or EEO data. Kept 4 years.
--
-- Ranking is off everywhere by default. A market row only enables it when
-- the independent bias audit has passed (and, for EU markets, AI Act
-- compliance is signed off; for the UK, the DPIA covers ranking). A scope
-- block is written automatically when a live impact ratio drops below 0.8.
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS career_ai_runs (
  id            BIGSERIAL PRIMARY KEY,
  purpose       TEXT NOT NULL CHECK (purpose IN ('extract_opening_requirements','extract_profile_skills',
                                                 'explain_match','rank_applicants','translate_draft')),
  opening_id    BIGINT REFERENCES career_openings(id) ON DELETE SET NULL,
  model         TEXT,
  model_digest  TEXT,
  input_hash    CHAR(64) NOT NULL,
  output        JSONB,
  used          BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_reason TEXT,
  accepted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_ai_runs_opening ON career_ai_runs (opening_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_ai_runs_cache ON career_ai_runs (purpose, input_hash) WHERE used;

CREATE TABLE IF NOT EXISTS career_ai_ranking_markets (
  market                 TEXT PRIMARY KEY CHECK (market ~ '^[A-Z]{2}(-[A-Z0-9]{1,6}){0,2}$'),
  is_eu                  BOOLEAN NOT NULL DEFAULT FALSE,
  bias_audit_passed_at   TIMESTAMPTZ,
  bias_audit_expires_at  TIMESTAMPTZ,
  bias_audit_ref         TEXT,
  bias_audit_summary_url TEXT,
  ai_act_signed_off_at   TIMESTAMPTZ,
  dpia_covers_ranking_at TIMESTAMPTZ,
  enabled                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS career_ai_ranking_blocks (
  id            BIGSERIAL PRIMARY KEY,
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('platform','market','business','opening')),
  scope_ref     TEXT NOT NULL,
  impact_ratio  NUMERIC(6,4),
  reason        TEXT NOT NULL,
  report_id     BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_ai_ranking_blocks_open
  ON career_ai_ranking_blocks (scope_type, scope_ref) WHERE reviewed_at IS NULL;

-- NYC LL144: notice to candidates at least 10 business days before ranking.
CREATE TABLE IF NOT EXISTS career_ai_ranking_notices (
  opening_id   BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  noticed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rank_allowed_from TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (opening_id)
);

CREATE TABLE IF NOT EXISTS career_fairness_reports (
  id            BIGSERIAL PRIMARY KEY,
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('platform','business','opening')),
  scope_ref     TEXT NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'quarterly' CHECK (kind IN ('quarterly','monthly_ranking')),
  metrics       JSONB NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_career_fairness_reports_scope ON career_fairness_reports (scope_type, scope_ref, period_end DESC);

COMMIT;
