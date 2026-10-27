-- OxSteed Careers, Phase 0 (careers spec §2.3, §6.5-§6.7, §6.14, §6.15).
--
-- Fixes C-01..C-18 at the schema level and prepares the launch tables:
--   * pay required to publish (Q12), pay sanity checks, daily/per_shift periods
--   * new final stages closed_unfilled / offer_declined (C-13), reason codes
--   * one pending offer per application, expiry status (C-03)
--   * store, path stage, guest/identity/employer-model/AI/background switches
--   * guest-apply email confirmation requests (Q3, C-07)
--   * per-state retention rules with the federal 1-year floor (Q18, Q15)
--   * restaurant hiring scopes: brand admin / regional manager (Q17, C-01)
--   * careers business settings and the careers.manage_hiring team permission
--
-- Idempotent: safe to re-run.

BEGIN;

-- ── Openings ────────────────────────────────────────────────────────────────
ALTER TABLE career_openings
  ADD COLUMN IF NOT EXISTS path_stage TEXT,
  ADD COLUMN IF NOT EXISTS job_role_code TEXT,
  ADD COLUMN IF NOT EXISTS brand_id BIGINT,
  ADD COLUMN IF NOT EXISTS restaurant_id BIGINT,
  ADD COLUMN IF NOT EXISTS region_id BIGINT,
  ADD COLUMN IF NOT EXISTS location_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  ADD COLUMN IF NOT EXISTS postal_centroid_id INTEGER REFERENCES geo_postal_centroids(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employer_model TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS allow_guest_applications BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hide_identity_until_offer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_ranking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS background_check_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS background_check_package TEXT,
  ADD COLUMN IF NOT EXISTS background_check_reason TEXT,
  ADD COLUMN IF NOT EXISTS promoted_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boost_id BIGINT,
  ADD COLUMN IF NOT EXISTS benefits_summary TEXT,
  ADD COLUMN IF NOT EXISTS schedule_summary TEXT,
  ADD COLUMN IF NOT EXISTS required_credentials TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS preferred_credentials TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS required_languages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS min_age SMALLINT NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS min_age_reason TEXT,
  ADD COLUMN IF NOT EXISTS applications_close_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pay_required_reason TEXT,
  ADD COLUMN IF NOT EXISTS content_locale TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sponsorship_available BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requirement_tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS removed_reason TEXT,
  ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hiring_event_id BIGINT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE career_openings SET path_stage = employment_type WHERE path_stage IS NULL;

DO $$ BEGIN
  ALTER TABLE career_openings DROP CONSTRAINT IF EXISTS career_openings_compensation_period_check;
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_compensation_period_check
    CHECK (compensation_period IN ('hourly','daily','per_shift','monthly','yearly'));
  ALTER TABLE career_openings DROP CONSTRAINT IF EXISTS career_openings_path_stage_check;
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_path_stage_check
    CHECK (path_stage IS NULL OR path_stage IN ('shift','part_time','full_time','seasonal','temporary','contract','intern'));
  ALTER TABLE career_openings DROP CONSTRAINT IF EXISTS career_openings_employer_model_check;
  -- Q1: EOR only for shift, seasonal and temporary openings.
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_employer_model_check
    CHECK (employer_model = 'direct'
           OR (employer_model = 'oxsteed_eor' AND path_stage IN ('shift','seasonal','temporary') AND employer_type = 'business'));
  ALTER TABLE career_openings DROP CONSTRAINT IF EXISTS career_openings_pay_sane;
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_pay_sane
    CHECK ((compensation_min IS NULL OR compensation_min >= 0)
       AND (compensation_max IS NULL OR compensation_max >= 0)
       AND (compensation_min IS NULL OR compensation_max IS NULL OR compensation_min <= compensation_max));
  ALTER TABLE career_openings DROP CONSTRAINT IF EXISTS career_openings_min_age_floor;
  -- Q9: Careers is 18 and up; a higher minimum only where the law requires it.
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_min_age_floor CHECK (min_age BETWEEN 18 AND 25);
  ALTER TABLE career_openings DROP CONSTRAINT IF EXISTS career_openings_moderation_check;
  ALTER TABLE career_openings ADD CONSTRAINT career_openings_moderation_check
    CHECK (moderation_status IN ('ok','flagged','removed'));
END $$;

-- Q12: an opening cannot be published (status 'open') without a pay range.
-- Older rows are only checked when they are (re)published or their pay
-- changes, so unrelated maintenance updates on legacy rows keep working;
-- the public list also hides any legacy open row that still has no pay.
CREATE OR REPLACE FUNCTION career_openings_require_pay() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'open'
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM 'open'
          OR OLD.compensation_min IS DISTINCT FROM NEW.compensation_min
          OR OLD.compensation_max IS DISTINCT FROM NEW.compensation_max)
     AND (NEW.compensation_min IS NULL OR NEW.compensation_max IS NULL) THEN
    RAISE EXCEPTION 'career opening needs a pay range before it can be published'
      USING ERRCODE = '23514', CONSTRAINT = 'career_openings_pay_required';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS career_openings_require_pay ON career_openings;
CREATE TRIGGER career_openings_require_pay BEFORE INSERT OR UPDATE ON career_openings
  FOR EACH ROW EXECUTE FUNCTION career_openings_require_pay();

-- C-16: full-text search and a trigram index instead of an unindexed ILIKE.
ALTER TABLE career_openings
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(requirements, '')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_career_openings_search_tsv ON career_openings USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_career_openings_title_trgm ON career_openings USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_career_openings_public_v2
  ON career_openings (status, moderation_status, updated_at DESC, id DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_career_openings_locations ON career_openings USING GIN (location_ids);
CREATE INDEX IF NOT EXISTS idx_career_openings_promoted ON career_openings (promoted_until) WHERE promoted_until IS NOT NULL;

-- ── Applications ────────────────────────────────────────────────────────────
ALTER TABLE career_applications
  ADD COLUMN IF NOT EXISTS profile_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS share_event_id BIGINT,
  ADD COLUMN IF NOT EXISTS invitation_id BIGINT,
  ADD COLUMN IF NOT EXISTS preferred_location_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  ADD COLUMN IF NOT EXISTS work_auth_country CHAR(2),
  ADD COLUMN IF NOT EXISTS authorized_to_work BOOLEAN,
  ADD COLUMN IF NOT EXISTS needs_sponsorship BOOLEAN,
  ADD COLUMN IF NOT EXISTS rejection_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS rejection_requirement TEXT,
  ADD COLUMN IF NOT EXISTS rejection_fact_type TEXT,
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_until DATE,
  ADD COLUMN IF NOT EXISTS retention_rule_id BIGINT,
  ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resume_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS guest_email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_age_attested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_rank_run_id BIGINT,
  ADD COLUMN IF NOT EXISTS ai_notice_shown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accommodation_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS human_review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applicant_number INTEGER,
  ADD COLUMN IF NOT EXISTS hiring_event_id BIGINT;

DO $$ BEGIN
  ALTER TABLE career_applications DROP CONSTRAINT IF EXISTS career_applications_stage_check;
  ALTER TABLE career_applications ADD CONSTRAINT career_applications_stage_check
    CHECK (stage IN ('received','screening','interview','assessment','offer','hired',
                     'rejected','withdrawn','offer_declined','closed_unfilled'));
  ALTER TABLE career_applications DROP CONSTRAINT IF EXISTS career_applications_reason_code_check;
  ALTER TABLE career_applications ADD CONSTRAINT career_applications_reason_code_check
    CHECK (rejection_reason_code IS NULL OR rejection_reason_code IN (
      'requirements_not_met','schedule_mismatch','position_filled','location_mismatch',
      'withdrew_interest','no_response','other_business_reason'));
  -- Q3: a guest application exists only after its email was confirmed.
  ALTER TABLE career_applications DROP CONSTRAINT IF EXISTS career_applications_guest_verified;
  ALTER TABLE career_applications ADD CONSTRAINT career_applications_guest_verified
    CHECK (NOT is_guest OR guest_email_verified_at IS NOT NULL);
END $$;

-- The "one active application per email" rule must ignore every final stage.
DROP INDEX IF EXISTS idx_career_applications_open_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_career_applications_open_email_v2
  ON career_applications (opening_id, lower(applicant_email))
  WHERE stage NOT IN ('withdrawn','rejected','offer_declined','closed_unfilled');
CREATE UNIQUE INDEX IF NOT EXISTS idx_career_applications_open_user
  ON career_applications (opening_id, user_id)
  WHERE user_id IS NOT NULL AND stage NOT IN ('withdrawn','rejected','offer_declined','closed_unfilled');
CREATE INDEX IF NOT EXISTS idx_career_applications_retention
  ON career_applications (retention_until) WHERE anonymized_at IS NULL AND retention_until IS NOT NULL;

ALTER TABLE career_application_events
  ADD COLUMN IF NOT EXISTS reason_code TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── Interviews ──────────────────────────────────────────────────────────────
ALTER TABLE career_interviews
  ADD COLUMN IF NOT EXISTS duration_minutes SMALLINT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS ics_uid TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS group_slot_id BIGINT;

-- ── Offers ──────────────────────────────────────────────────────────────────
ALTER TABLE career_offers
  ADD COLUMN IF NOT EXISTS location_id BIGINT,
  ADD COLUMN IF NOT EXISTS job_role_code TEXT,
  ADD COLUMN IF NOT EXISTS pay_cents BIGINT,
  ADD COLUMN IF NOT EXISTS pay_period TEXT,
  ADD COLUMN IF NOT EXISTS outside_posted_range_reason TEXT,
  ADD COLUMN IF NOT EXISTS first_shift JSONB,
  ADD COLUMN IF NOT EXISTS conditions TEXT[] NOT NULL DEFAULT ARRAY['identity_verified']::TEXT[],
  ADD COLUMN IF NOT EXISTS employer_model TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS above_range BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS above_range_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS above_range_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS letter_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS accepted_terms_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS is_conditional BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expiry_warned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT;

DO $$ BEGIN
  ALTER TABLE career_offers DROP CONSTRAINT IF EXISTS career_offers_status_check;
  ALTER TABLE career_offers ADD CONSTRAINT career_offers_status_check
    CHECK (status IN ('pending','awaiting_approval','accepted','declined','withdrawn','expired'));
  ALTER TABLE career_offers DROP CONSTRAINT IF EXISTS career_offers_compensation_period_check;
  ALTER TABLE career_offers ADD CONSTRAINT career_offers_compensation_period_check
    CHECK (compensation_period IN ('hourly','daily','per_shift','monthly','yearly'));
  ALTER TABLE career_offers DROP CONSTRAINT IF EXISTS career_offers_pay_period_check;
  ALTER TABLE career_offers ADD CONSTRAINT career_offers_pay_period_check
    CHECK (pay_period IS NULL OR pay_period IN ('hourly','daily','per_shift','monthly','yearly'));
  ALTER TABLE career_offers DROP CONSTRAINT IF EXISTS career_offers_pay_nonneg;
  ALTER TABLE career_offers ADD CONSTRAINT career_offers_pay_nonneg CHECK (pay_cents IS NULL OR pay_cents >= 0);
END $$;

-- C-03: before the one-live-offer index, retire older duplicate live offers.
UPDATE career_offers o
   SET status = 'withdrawn', decided_at = COALESCE(o.decided_at, NOW()),
       withdrawn_reason = 'superseded_by_newer_offer'
 WHERE o.status = 'pending'
   AND EXISTS (SELECT 1 FROM career_offers n
                WHERE n.application_id = o.application_id AND n.status = 'pending'
                  AND (n.created_at, n.id) > (o.created_at, o.id));
CREATE UNIQUE INDEX IF NOT EXISTS idx_career_offers_one_live
  ON career_offers (application_id) WHERE status IN ('pending','awaiting_approval');
CREATE INDEX IF NOT EXISTS idx_career_offers_expiry
  ON career_offers (expires_at) WHERE status = 'pending' AND expires_at IS NOT NULL;

-- ── Guest apply (Q3) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_guest_apply_requests (
  id              BIGSERIAL PRIMARY KEY,
  opening_id      BIGINT NOT NULL REFERENCES career_openings(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  token_hash      CHAR(64) NOT NULL UNIQUE,
  ip_hash         CHAR(64),
  payload         JSONB NOT NULL,
  locale          TEXT NOT NULL DEFAULT 'en',
  expires_at      TIMESTAMPTZ NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  application_id  BIGINT REFERENCES career_applications(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_career_guest_requests_email ON career_guest_apply_requests (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_career_guest_requests_ip ON career_guest_apply_requests (ip_hash, created_at DESC);

-- ── Retention rules (Q15, Q18) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_retention_rules (
  id           BIGSERIAL PRIMARY KEY,
  country      CHAR(2) NOT NULL,
  region       TEXT,
  applies_to   TEXT NOT NULL CHECK (applies_to IN ('application','eeo','ai_run','background_check')),
  keep_months  SMALLINT NOT NULL CHECK (keep_months BETWEEN 1 AND 120),
  legal_source TEXT NOT NULL,
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_retention_rules
  ON career_retention_rules (country, COALESCE(region, ''), applies_to);

-- Seeds are minimums; a lawyer reviews the table every quarter (§12.6 ⚖).
-- reviewed_at stays NULL until that review happens.
INSERT INTO career_retention_rules (country, region, applies_to, keep_months, legal_source) VALUES
  ('US', NULL, 'application', 12, 'Federal floor: 29 CFR 1602.14 (EEOC) - one year from the record or the decision'),
  ('US', 'CA', 'application', 48, 'California Gov. Code 12946 / 2 CCR 11013 - four years'),
  ('US', 'CO', 'application', 24, 'Colorado C.R.S. 24-34-408 (HB 22-1367) - two years'),
  ('US', NULL, 'ai_run', 48, 'California FEHA automated-decision rules (4 years) and Colorado SB 26-189 (3 years)'),
  ('CA', NULL, 'application', 12, 'Canada default - one year pending province review'),
  ('GB', NULL, 'application', 12, 'UK GDPR - 12 months after the decision (Q15)')
ON CONFLICT DO NOTHING;
INSERT INTO career_retention_rules (country, region, applies_to, keep_months, legal_source)
SELECT c, NULL, 'application', 12, 'GDPR - 12 months after the decision (Q15)'
  FROM unnest(ARRAY['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']) AS c
ON CONFLICT DO NOTHING;

-- ── Careers business settings (§6.15) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS career_business_settings (
  business_id                       INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  default_employer_model            TEXT NOT NULL DEFAULT 'direct' CHECK (default_employer_model IN ('direct','oxsteed_eor')),
  allow_guest_applications_default  BOOLEAN NOT NULL DEFAULT FALSE,
  hide_identity_default             BOOLEAN NOT NULL DEFAULT FALSE,
  ai_ranking_default                BOOLEAN NOT NULL DEFAULT FALSE,
  background_checks_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  checkr_account_ref                TEXT,
  shift_nudge_threshold             SMALLINT NOT NULL DEFAULT 6 CHECK (shift_nudge_threshold BETWEEN 1 AND 100),
  clock_in_grace_minutes            SMALLINT NOT NULL DEFAULT 7 CHECK (clock_in_grace_minutes BETWEEN 0 AND 60),
  employer_digest_opt_out           BOOLEAN NOT NULL DEFAULT FALSE,
  permissible_purpose_certified_at  TIMESTAMPTZ,
  permissible_purpose_certified_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by                        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Restaurant hiring scopes (Q17) ──────────────────────────────────────────
-- Owners hire anywhere. A manager with a 'brand' scope is a brand admin
-- (anywhere in the business's brand, and may approve above-range offers);
-- a 'region' scope makes them a regional manager for that region's stores.
-- Managers without a scope keep their existing store assignments
-- (restaurant_location_memberships) as store managers. Every non-owner may
-- only hire into roles below their own (S-09 rank guard).
CREATE TABLE IF NOT EXISTS career_hiring_scopes (
  id             BIGSERIAL PRIMARY KEY,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  membership_id  BIGINT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  scope_level    TEXT NOT NULL CHECK (scope_level IN ('brand','region')),
  region_id      BIGINT REFERENCES restaurant_regions(id) ON DELETE CASCADE,
  granted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,
  CONSTRAINT career_hiring_scopes_shape CHECK (
    (scope_level = 'brand' AND region_id IS NULL) OR (scope_level = 'region' AND region_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_career_hiring_scopes_active
  ON career_hiring_scopes (membership_id, scope_level, COALESCE(region_id, 0)) WHERE revoked_at IS NULL;

-- ── Team permission (Appendix A) ────────────────────────────────────────────
INSERT INTO team_permissions (code, group_key, description) VALUES
  ('careers.manage_hiring', 'careers', 'Post openings, review applicants and make offers within your hiring scope.'),
  ('careers.approve_above_range', 'careers', 'Approve offers above an opening''s posted pay range (owner or brand admin).')
ON CONFLICT (code) DO UPDATE SET group_key = EXCLUDED.group_key, description = EXCLUDED.description;
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r JOIN team_permissions p ON p.code = 'careers.manage_hiring'
 WHERE r.code IN ('owner','manager')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allow = EXCLUDED.allow;
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r JOIN team_permissions p ON p.code = 'careers.approve_above_range'
 WHERE r.code = 'owner'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allow = EXCLUDED.allow;

COMMIT;
