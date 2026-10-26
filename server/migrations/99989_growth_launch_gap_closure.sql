-- 99989_growth_launch_gap_closure.sql
-- Closes the demand-engine launch gaps from the Oct 26 progress review.
-- Append-only: nothing here rewrites an applied migration.
--
-- N-01  "personalized" is derived from the segment definition, never trusted
--       from the admin flag. A segment that uses intents, activity facts,
--       propensity, a behavioural cluster or recent-activity lifecycle is
--       personalized (spec §4.6 / D10). A trigger forces the campaign flag to
--       TRUE for those segments, so every reader (approval, queue, delivery,
--       partner redirect, sale/share withdrawal) sees the safe value.
-- D23   licensed listings: permitted uses, provenance columns, entity type,
--       matched-business exclusion, hashed do-not-contact keys, and per-country
--       B2B outreach rules on jurisdiction_rules (unreviewed = closed).
-- D21   Amazon Associates campaign-level results (Amazon reports by tracking
--       tag only; there is no per-click attribution).
-- D-ENG-06 provider-agnostic age verification ledger (no vendor chosen).
-- D16   admin operational notices + geo-source switch history for rollback.
-- N-04  backup kind (full / incremental) for the daily+weekly schedule.

-- ── N-01 ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION growth_segment_is_personalized(def JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    (jsonb_typeof(def->'intents') = 'array' AND jsonb_array_length(def->'intents') > 0)
    OR (jsonb_typeof(def->'facts') = 'array' AND jsonb_array_length(def->'facts') > 0)
    OR (jsonb_typeof(def->'propensity') = 'object')
    OR (def->'area'->>'type') = 'cluster'
    OR (jsonb_typeof(def->'lifecycle'->'last_active_within_days') = 'number'),
    FALSE)
$$;

ALTER TABLE growth_segment_versions
  ADD COLUMN IF NOT EXISTS is_personalized BOOLEAN
  GENERATED ALWAYS AS (growth_segment_is_personalized(definition)) STORED;

CREATE OR REPLACE FUNCTION offer_campaign_force_personalized() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM growth_segment_versions v
     WHERE v.id = NEW.segment_version_id AND v.is_personalized
  ) THEN
    NEW.is_personalized := TRUE;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS offer_campaigns_force_personalized ON offer_campaigns;
CREATE TRIGGER offer_campaigns_force_personalized
  BEFORE INSERT OR UPDATE OF segment_version_id, is_personalized ON offer_campaigns
  FOR EACH ROW EXECUTE FUNCTION offer_campaign_force_personalized();

-- Existing campaigns mislabelled as broad are corrected in place.
UPDATE offer_campaigns c
   SET is_personalized = TRUE, updated_at = NOW()
  FROM growth_segment_versions v
 WHERE v.id = c.segment_version_id AND v.is_personalized AND c.is_personalized IS NOT TRUE;

-- ── D23 licensed listings ───────────────────────────────────────────────
ALTER TABLE prospect_businesses
  ADD COLUMN IF NOT EXISTS permitted_uses TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS license_version TEXT,
  ADD COLUMN IF NOT EXISTS acquired_at DATE,
  ADD COLUMN IF NOT EXISTS category_code TEXT,
  ADD COLUMN IF NOT EXISTS postal_ref INTEGER,
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS matched_business_id INTEGER,
  ADD COLUMN IF NOT EXISTS usable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS unusable_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_import_id BIGINT;
ALTER TABLE prospect_businesses DROP CONSTRAINT IF EXISTS prospect_businesses_permitted_uses_check;
ALTER TABLE prospect_businesses ADD CONSTRAINT prospect_businesses_permitted_uses_check
  CHECK (permitted_uses <@ ARRAY['supply_maps','analytics','internal_research','marketing_outreach']::TEXT[]);
ALTER TABLE prospect_businesses DROP CONSTRAINT IF EXISTS prospect_businesses_entity_type_check;
ALTER TABLE prospect_businesses ADD CONSTRAINT prospect_businesses_entity_type_check
  CHECK (entity_type IN ('corporate','sole_trader','partnership','unknown'));
-- Outreach is impossible unless the licence explicitly permits marketing use.
ALTER TABLE prospect_businesses DROP CONSTRAINT IF EXISTS prospect_businesses_outreach_licence_check;
UPDATE prospect_businesses SET outreach_allowed = FALSE,
       outreach_status = CASE WHEN outreach_status = 'eligible' THEN 'not_started' ELSE outreach_status END
 WHERE outreach_allowed AND NOT ('marketing_outreach' = ANY(permitted_uses));
ALTER TABLE prospect_businesses ADD CONSTRAINT prospect_businesses_outreach_licence_check
  CHECK (NOT outreach_allowed OR (usable AND 'marketing_outreach' = ANY(permitted_uses)));
CREATE INDEX IF NOT EXISTS prospect_businesses_usable_idx
  ON prospect_businesses(country, category_code) WHERE usable;

ALTER TABLE prospect_suppressions
  ADD COLUMN IF NOT EXISTS email_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS phone_hash CHAR(64);
ALTER TABLE prospect_suppressions DROP CONSTRAINT IF EXISTS prospect_suppressions_check;
ALTER TABLE prospect_suppressions ADD CONSTRAINT prospect_suppressions_key_check
  CHECK (source_record_id IS NOT NULL OR normalized_name IS NOT NULL
         OR email_hash IS NOT NULL OR phone_hash IS NOT NULL);
CREATE INDEX IF NOT EXISTS prospect_suppressions_email_idx ON prospect_suppressions(email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospect_suppressions_phone_idx ON prospect_suppressions(phone_hash) WHERE phone_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS prospect_imports (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  license_ref TEXT NOT NULL,
  license_version TEXT NOT NULL,
  permitted_uses TEXT[] NOT NULL,
  license_expires_at DATE,
  acquired_at DATE NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  imported INTEGER NOT NULL DEFAULT 0,
  suppressed INTEGER NOT NULL DEFAULT 0,
  matched_existing INTEGER NOT NULL DEFAULT 0,
  marked_unusable INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  imported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, content_sha256),
  CHECK (permitted_uses <@ ARRAY['supply_maps','analytics','internal_research','marketing_outreach']::TEXT[])
);

-- Per-country B2B outreach rules. 'unset' and an unreviewed row both mean
-- no outreach in that country (fail closed). Values are conservative
-- engineering defaults for legal to confirm, not legal approval.
ALTER TABLE jurisdiction_rules
  ADD COLUMN IF NOT EXISTS b2b_email_basis TEXT NOT NULL DEFAULT 'unset',
  ADD COLUMN IF NOT EXISTS b2b_sole_trader_email_basis TEXT NOT NULL DEFAULT 'unset',
  ADD COLUMN IF NOT EXISTS b2b_phone_basis TEXT NOT NULL DEFAULT 'unset',
  ADD COLUMN IF NOT EXISTS b2b_requires_postal_address BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS b2b_requires_art14_notice BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS b2b_law TEXT,
  ADD COLUMN IF NOT EXISTS b2b_rules_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS b2b_rules_legal_ref TEXT;
ALTER TABLE jurisdiction_rules DROP CONSTRAINT IF EXISTS jurisdiction_rules_b2b_basis_check;
ALTER TABLE jurisdiction_rules ADD CONSTRAINT jurisdiction_rules_b2b_basis_check CHECK (
  b2b_email_basis IN ('unset','prohibited','consent','implied_or_consent','opt_out')
  AND b2b_sole_trader_email_basis IN ('unset','prohibited','consent','implied_or_consent','opt_out')
  AND b2b_phone_basis IN ('unset','prohibited','consent','implied_or_consent','opt_out'));
ALTER TABLE jurisdiction_rules DROP CONSTRAINT IF EXISTS jurisdiction_rules_b2b_review_check;
ALTER TABLE jurisdiction_rules ADD CONSTRAINT jurisdiction_rules_b2b_review_check
  CHECK (b2b_rules_reviewed_at IS NULL OR b2b_rules_legal_ref IS NOT NULL);

UPDATE jurisdiction_rules SET b2b_email_basis='opt_out', b2b_sole_trader_email_basis='opt_out',
       b2b_phone_basis='consent', b2b_requires_postal_address=TRUE, b2b_law='CAN-SPAM; TCPA/DNC'
 WHERE code='US' OR code LIKE 'US-%';
UPDATE jurisdiction_rules SET b2b_email_basis='implied_or_consent', b2b_sole_trader_email_basis='implied_or_consent',
       b2b_phone_basis='consent', b2b_requires_postal_address=TRUE, b2b_law='CASL'
 WHERE code IN ('CA','CA-QC');
UPDATE jurisdiction_rules SET b2b_email_basis='opt_out', b2b_sole_trader_email_basis='consent',
       b2b_phone_basis='consent', b2b_requires_art14_notice=TRUE, b2b_law='PECR; UK GDPR Art. 14'
 WHERE code='GB';
UPDATE jurisdiction_rules SET b2b_email_basis='consent', b2b_sole_trader_email_basis='consent',
       b2b_phone_basis='consent', b2b_requires_art14_notice=TRUE, b2b_law='ePrivacy; GDPR Art. 14'
 WHERE code IN ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV',
                'LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO');
UPDATE jurisdiction_rules SET b2b_email_basis='prohibited', b2b_sole_trader_email_basis='prohibited',
       b2b_phone_basis='prohibited', b2b_law='set per country by legal before outreach'
 WHERE code IN ('unknown','default','CH');

-- ── D21 Amazon campaign-level results ──────────────────────────────────
ALTER TABLE amazon_associate_reports
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS amazon_campaign_results (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES amazon_associate_reports(id) ON DELETE CASCADE,
  tracking_tag TEXT NOT NULL,
  campaign_id BIGINT REFERENCES offer_campaigns(id) ON DELETE SET NULL,
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  ordered_items INTEGER NOT NULL DEFAULT 0 CHECK (ordered_items >= 0),
  shipped_items INTEGER NOT NULL DEFAULT 0,
  revenue_minor BIGINT NOT NULL DEFAULT 0,
  earnings_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3),
  UNIQUE (report_id, tracking_tag)
);
CREATE INDEX IF NOT EXISTS amazon_campaign_results_campaign_idx ON amazon_campaign_results(campaign_id);
ALTER TABLE marketplace_products
  ADD COLUMN IF NOT EXISTS partner_refreshed_at TIMESTAMPTZ;

-- ── D-ENG-06 age verification (provider-agnostic) ──────────────────────
CREATE TABLE IF NOT EXISTS growth_age_verifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('provider','signup_self_attestation','in_app_self_attestation','admin_review')),
  provider TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('adult','minor','unknown','revoked')),
  evidence_ref TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  minimum_age SMALLINT NOT NULL CHECK (minimum_age BETWEEN 13 AND 25),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS growth_age_verifications_user_idx ON growth_age_verifications(user_id, id DESC);
ALTER TABLE growth_subject_eligibility
  ADD COLUMN IF NOT EXISTS age_method TEXT,
  ADD COLUMN IF NOT EXISTS age_policy_version TEXT;

-- ── D16 admin notices + geo-source switch history ──────────────────────
CREATE TABLE IF NOT EXISTS admin_operational_notices (
  id BIGSERIAL PRIMARY KEY,
  notice_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('analytics','growth','operations')),
  title_key TEXT NOT NULL,
  body_key TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience_permission TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_operational_notice_acks (
  notice_id BIGINT NOT NULL REFERENCES admin_operational_notices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notice_id, user_id)
);
CREATE TABLE IF NOT EXISTS region_geo_source_switches (
  id BIGSERIAL PRIMARY KEY,
  from_source TEXT NOT NULL,
  to_source TEXT NOT NULL CHECK (to_source IN ('direct_geocode_cache','geo_postal_centroids')),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run','switch','rollback')),
  diff JSONB NOT NULL,
  coverage JSONB NOT NULL,
  source_version TEXT,
  notice_id BIGINT REFERENCES admin_operational_notices(id) ON DELETE SET NULL,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── N-04 backup kinds ───────────────────────────────────────────────────
ALTER TABLE growth_ops_runs
  ADD COLUMN IF NOT EXISTS backup_kind TEXT,
  ADD COLUMN IF NOT EXISTS base_backup_ref TEXT;
ALTER TABLE growth_ops_runs DROP CONSTRAINT IF EXISTS growth_ops_runs_backup_kind_check;
ALTER TABLE growth_ops_runs ADD CONSTRAINT growth_ops_runs_backup_kind_check
  CHECK (backup_kind IS NULL OR backup_kind IN ('full','incremental'));
CREATE INDEX IF NOT EXISTS growth_ops_runs_backup_complete_idx
  ON growth_ops_runs(started_at DESC) WHERE operation='backup' AND status='complete';
