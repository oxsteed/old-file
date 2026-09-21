-- Migration 531: OxSteed careers / hiring pipeline
--
-- Shared employment ATS for:
--   * OxSteed platform roles (employer_type = 'platform', business_id NULL)
--   * Business-owner hiring in Business Hub (employer_type = 'business')
--
-- Distinct from marketplace `jobs` (customer-posted gigs). These are
-- employer-owned openings with an international screening → hire cycle
-- that can convert a hire into a business_members row.
--
-- Idempotent. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS career_openings (
  id                    BIGSERIAL PRIMARY KEY,
  employer_type         TEXT NOT NULL CHECK (employer_type IN ('platform', 'business')),
  business_id           INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  slug                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  department            TEXT NOT NULL DEFAULT 'other',
  employment_type       TEXT NOT NULL DEFAULT 'full_time'
                          CHECK (employment_type IN ('full_time','part_time','contract','intern','seasonal','temporary')),
  workplace_type        TEXT NOT NULL DEFAULT 'hybrid'
                          CHECK (workplace_type IN ('onsite','hybrid','remote')),
  country_code          CHAR(2),
  region                TEXT,
  city                  TEXT,
  timezone              TEXT,
  currency_code         CHAR(3) NOT NULL DEFAULT 'USD',
  compensation_min      NUMERIC(12,2),
  compensation_max      NUMERIC(12,2),
  compensation_period   TEXT NOT NULL DEFAULT 'yearly'
                          CHECK (compensation_period IN ('hourly','monthly','yearly')),
  work_authorization    TEXT NOT NULL DEFAULT 'local_authorized'
                          CHECK (work_authorization IN ('local_authorized','visa_sponsorship','any')),
  languages             TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[],
  description           TEXT NOT NULL DEFAULT '',
  requirements          TEXT NOT NULL DEFAULT '',
  benefits              TEXT NOT NULL DEFAULT '',
  team_role             TEXT CHECK (team_role IS NULL OR team_role IN ('employee','manager','representative','support_agent')),
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','open','paused','closed','filled')),
  opens_at              TIMESTAMPTZ,
  closes_at             TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT career_openings_employer_shape CHECK (
    (employer_type = 'platform' AND business_id IS NULL)
    OR (employer_type = 'business' AND business_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_career_openings_platform_slug
  ON career_openings (slug)
  WHERE employer_type = 'platform';

CREATE UNIQUE INDEX IF NOT EXISTS idx_career_openings_business_slug
  ON career_openings (business_id, slug)
  WHERE employer_type = 'business';

CREATE INDEX IF NOT EXISTS idx_career_openings_public
  ON career_openings (status, workplace_type, country_code, department)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_career_openings_business
  ON career_openings (business_id, status)
  WHERE business_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS career_applications (
  id                         BIGSERIAL PRIMARY KEY,
  opening_id                 BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  user_id                    UUID REFERENCES users(id) ON DELETE SET NULL,
  applicant_email            TEXT NOT NULL,
  first_name                 TEXT NOT NULL,
  last_name                  TEXT NOT NULL,
  phone                      TEXT,
  country_code               CHAR(2),
  city                       TEXT,
  timezone                   TEXT,
  locale                     TEXT NOT NULL DEFAULT 'en',
  resume_url                 TEXT,
  cover_letter               TEXT,
  work_authorization_status  TEXT NOT NULL DEFAULT 'local_authorized'
                               CHECK (work_authorization_status IN ('local_authorized','visa_sponsorship','any')),
  willing_to_relocate        BOOLEAN NOT NULL DEFAULT FALSE,
  languages                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  stage                      TEXT NOT NULL DEFAULT 'received'
                               CHECK (stage IN ('received','screening','interview','assessment','offer','hired','rejected','withdrawn')),
  source                     TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_career_applications_open_email
  ON career_applications (opening_id, lower(applicant_email))
  WHERE stage NOT IN ('withdrawn','rejected');

CREATE INDEX IF NOT EXISTS idx_career_applications_opening_stage
  ON career_applications (opening_id, stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_career_applications_user
  ON career_applications (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS career_application_events (
  id                BIGSERIAL PRIMARY KEY,
  application_id    BIGINT NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
  actor_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  from_stage        TEXT,
  to_stage          TEXT NOT NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_application_events_app
  ON career_application_events (application_id, created_at ASC);

CREATE TABLE IF NOT EXISTS career_interviews (
  id                BIGSERIAL PRIMARY KEY,
  application_id    BIGINT NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'UTC',
  mode              TEXT NOT NULL DEFAULT 'video'
                      CHECK (mode IN ('video','phone','onsite')),
  location          TEXT,
  status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes             TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_interviews_app
  ON career_interviews (application_id, scheduled_at);

CREATE TABLE IF NOT EXISTS career_offers (
  id                BIGSERIAL PRIMARY KEY,
  application_id    BIGINT NOT NULL REFERENCES career_applications(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  currency_code     CHAR(3) NOT NULL DEFAULT 'USD',
  compensation      NUMERIC(12,2),
  compensation_period TEXT NOT NULL DEFAULT 'yearly'
                      CHECK (compensation_period IN ('hourly','monthly','yearly')),
  start_date        DATE,
  expires_at        TIMESTAMPTZ,
  team_role         TEXT CHECK (team_role IS NULL OR team_role IN ('employee','manager','representative','support_agent')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','withdrawn')),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_career_offers_app
  ON career_offers (application_id, created_at DESC);

COMMIT;
