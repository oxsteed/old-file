-- OxSteed Careers, Phase 1: verified work profile (careers spec §6.1-§6.4, §9).
--
-- career_profiles            the worker's own content and visibility
-- career_profile_facts       facts OxSteed computed from its own records
-- career_profile_share_events append-only consent ledger (like tracking_consents)
-- career_profile_share_current current sharing state per worker
-- career_profile_access_log  every employer view (worker sees "who viewed")
-- career_profile_mutes       businesses a worker muted (no invitations)
-- career_fact_disputes       FCRA-style 30-day reinvestigation of a fact
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS career_profiles (
  user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline              VARCHAR(120),
  summary               TEXT CHECK (summary IS NULL OR char_length(summary) <= 1500),
  desired_roles         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  desired_employment    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  availability          JSONB NOT NULL DEFAULT '[]'::jsonb,
  postal_centroid_id    INTEGER REFERENCES geo_postal_centroids(id) ON DELETE SET NULL,
  travel_radius_km      SMALLINT CHECK (travel_radius_km IS NULL OR travel_radius_km BETWEEN 1 AND 500),
  languages             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  skill_codes           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  min_pay_cents         BIGINT CHECK (min_pay_cents IS NULL OR min_pay_cents >= 0),
  min_pay_period        TEXT,
  resume_storage_key    TEXT,
  resume_filename       TEXT,
  visibility            TEXT NOT NULL DEFAULT 'private'
                          CHECK (visibility IN ('private','apply_only','known_businesses','searchable')),
  hidden_fact_types     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  open_to_work          BOOLEAN NOT NULL DEFAULT FALSE,
  profile_locale        TEXT NOT NULL DEFAULT 'en',
  career_offers_opt_in  BOOLEAN NOT NULL DEFAULT FALSE,
  email_invitations     BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_notice_version TEXT,
  last_active_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_profiles_searchable
  ON career_profiles (postal_centroid_id) WHERE visibility = 'searchable';
CREATE INDEX IF NOT EXISTS idx_career_profiles_skills ON career_profiles USING GIN (skill_codes);

CREATE TABLE IF NOT EXISTS career_profile_facts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact_type    TEXT NOT NULL CHECK (fact_type IN (
                 'completed_jobs','avg_rating','on_time_rate','response_rate','training_completed',
                 'certificate','badge','shifts_worked','tenure','id_verified')),
  category     TEXT,
  value        JSONB NOT NULL,
  sample_size  INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL,
  source_ref   JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until  TIMESTAMPTZ
);
-- background_check and rehire_eligible are never stored here: they are
-- employer-specific and computed per viewing employer (§9.1).
CREATE INDEX IF NOT EXISTS idx_career_profile_facts_user ON career_profile_facts (user_id, fact_type);

CREATE TABLE IF NOT EXISTS career_profile_share_events (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          TEXT NOT NULL CHECK (action IN (
                    'set_visibility','share_with_application','revoke','mute_business','unmute',
                    'career_offers_opt_in','career_offers_opt_out','hide_facts')),
  audience        JSONB NOT NULL DEFAULT '{}'::jsonb,
  fact_types      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  policy_version  TEXT NOT NULL,
  ip_hash         CHAR(64),
  user_agent_hash CHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_share_events_user ON career_profile_share_events (user_id, created_at DESC);

-- Append-only: rows are never updated, and only deleted by erasure (§12.6),
-- which sets careers.erasure = 'on' for its transaction.
CREATE OR REPLACE FUNCTION career_share_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('careers.erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'career_profile_share_events is append-only' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS career_share_events_append_only ON career_profile_share_events;
CREATE TRIGGER career_share_events_append_only BEFORE UPDATE OR DELETE ON career_profile_share_events
  FOR EACH ROW EXECUTE FUNCTION career_share_events_append_only();

CREATE TABLE IF NOT EXISTS career_profile_share_current (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  visibility         TEXT NOT NULL DEFAULT 'private',
  hidden_fact_types  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  career_offers_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  last_event_id      BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS career_profile_access_log (
  id               BIGSERIAL PRIMARY KEY,
  viewer_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  business_id      INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  subject_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context          TEXT NOT NULL CHECK (context IN ('application','invitation_list','talent_pool','talent_search')),
  application_id   BIGINT REFERENCES career_applications(id) ON DELETE SET NULL,
  fact_types       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_access_log_subject ON career_profile_access_log (subject_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_access_log_business ON career_profile_access_log (business_id, context, created_at DESC);

CREATE TABLE IF NOT EXISTS career_profile_mutes (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, business_id)
);

CREATE TABLE IF NOT EXISTS career_fact_disputes (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact_type      TEXT NOT NULL,
  fact_id        BIGINT,
  source_ref     JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason         TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  hide_while_reviewing BOOLEAN NOT NULL DEFAULT TRUE,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','rejected')),
  resolution_note TEXT,
  resolved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at         TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_fact_disputes_open ON career_fact_disputes (status, due_at) WHERE status = 'open';

COMMIT;
