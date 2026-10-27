-- OxSteed Credit licence readiness, part 6: in-house sanctions screening.
-- No paid vendor: public official lists (OFAC SDN + consolidated, UN
-- Security Council consolidated, EU financial sanctions, UK sanctions list,
-- Canada SEMA) plus a custom Haiti list maintained by two administrators.
-- Lists are versioned (sha256 + counts) so every screening can name the
-- exact list versions it ran against; a new version triggers a targeted
-- rescreen of every known subject whose name is close to an added name.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS credit_sanctions_list_sources (
  id VARCHAR(40) PRIMARY KEY,
  display_name TEXT NOT NULL,
  authority TEXT NOT NULL,
  format VARCHAR(30) NOT NULL CHECK (format IN ('ofac_csv', 'un_xml', 'eu_xml', 'uk_xml', 'sema_xml', 'custom')),
  url TEXT,
  aux_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Required sources must be fresh for an automated screening to clear
  -- anyone; a stale required source makes screening fail closed.
  required BOOLEAN NOT NULL DEFAULT TRUE,
  max_age_hours INTEGER NOT NULL DEFAULT 72 CHECK (max_age_hours BETWEEN 1 AND 2160),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  active_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO credit_sanctions_list_sources (id, display_name, authority, format, url, aux_url, required, max_age_hours) VALUES
  ('ofac_sdn', 'OFAC Specially Designated Nationals', 'US Treasury OFAC', 'ofac_csv',
   'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/sdn.csv',
   'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/alt.csv', TRUE, 72),
  ('ofac_cons', 'OFAC Consolidated (non-SDN)', 'US Treasury OFAC', 'ofac_csv',
   'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/cons_prim.csv',
   'https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/cons_alt.csv', TRUE, 72),
  ('un', 'UN Security Council Consolidated List (incl. Haiti 2653 regime)', 'United Nations', 'un_xml',
   'https://scsanctions.un.org/resources/xml/en/consolidated.xml', NULL, TRUE, 72),
  ('eu', 'EU Financial Sanctions (consolidated)', 'European Commission', 'eu_xml',
   'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw', NULL, TRUE, 96),
  ('uk', 'UK Sanctions List', 'UK FCDO', 'uk_xml',
   'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml', NULL, TRUE, 96),
  ('ca_sema', 'Canada Consolidated Autonomous Sanctions (SEMA)', 'Global Affairs Canada', 'sema_xml',
   'https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.xml', NULL, TRUE, 168),
  ('custom_ht', 'OxSteed custom list (Haiti designations and internal)', 'OxSteed compliance (two administrators)', 'custom',
   NULL, NULL, FALSE, 2160)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS credit_sanctions_list_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(40) NOT NULL REFERENCES credit_sanctions_list_sources(id),
  sha256 CHAR(64) NOT NULL,
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  name_count INTEGER NOT NULL CHECK (name_count >= 0),
  added_name_count INTEGER NOT NULL DEFAULT 0,
  removed_name_count INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_via VARCHAR(20) NOT NULL DEFAULT 'fetch' CHECK (ingested_via IN ('fetch', 'file', 'custom')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'rejected')),
  rejection_reason TEXT,
  rescreened_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_versions_source ON credit_sanctions_list_versions (source_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_versions_rescreen ON credit_sanctions_list_versions (fetched_at) WHERE rescreened_at IS NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS credit_sanctions_list_entries (
  id BIGSERIAL PRIMARY KEY,
  source_id VARCHAR(40) NOT NULL REFERENCES credit_sanctions_list_sources(id),
  version_id UUID NOT NULL REFERENCES credit_sanctions_list_versions(id),
  external_id TEXT NOT NULL,
  entry_type VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (entry_type IN ('individual', 'entity', 'vessel', 'aircraft', 'unknown')),
  primary_name TEXT NOT NULL,
  programs TEXT[] NOT NULL DEFAULT '{}',
  countries TEXT[] NOT NULL DEFAULT '{}',
  birth_dates TEXT[] NOT NULL DEFAULT '{}',
  remarks TEXT,
  UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS credit_sanctions_list_names (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES credit_sanctions_list_entries(id) ON DELETE CASCADE,
  source_id VARCHAR(40) NOT NULL,
  name TEXT NOT NULL,
  normalized TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  strength VARCHAR(10) NOT NULL DEFAULT 'strong' CHECK (strength IN ('strong', 'weak'))
);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_names_trgm ON credit_sanctions_list_names USING GIN (normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_names_entry ON credit_sanctions_list_names (entry_id);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_names_source ON credit_sanctions_list_names (source_id);

-- Normalised names added by a version (rescreen targets only these).
CREATE TABLE IF NOT EXISTS credit_sanctions_list_deltas (
  version_id UUID NOT NULL REFERENCES credit_sanctions_list_versions(id) ON DELETE CASCADE,
  normalized TEXT NOT NULL,
  PRIMARY KEY (version_id, normalized)
);

-- Custom designations (Haiti national measures, internal blocks). Adding or
-- removing one needs two different administrators.
CREATE TABLE IF NOT EXISTS credit_sanctions_custom_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('individual', 'entity', 'vessel', 'aircraft', 'unknown')),
  primary_name TEXT NOT NULL CHECK (length(trim(primary_name)) >= 2),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  countries TEXT[] NOT NULL DEFAULT '{}',
  birth_dates TEXT[] NOT NULL DEFAULT '{}',
  legal_basis TEXT NOT NULL,
  source_reference TEXT,
  added_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES users(id),
  removal_approved_by UUID REFERENCES users(id),
  removal_reason TEXT,
  CONSTRAINT credit_sanctions_custom_two_person CHECK (added_by <> approved_by),
  CONSTRAINT credit_sanctions_custom_removal_two_person CHECK (
    removed_at IS NULL OR (removed_by IS NOT NULL AND removal_approved_by IS NOT NULL AND removed_by <> removal_approved_by AND removal_reason IS NOT NULL)
  )
);

-- Names each known subject was screened under, so a list update can find
-- affected subjects without rescanning the whole user table.
CREATE TABLE IF NOT EXISTS credit_sanctions_subject_names (
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('customer', 'partner', 'counterparty')),
  subject_id TEXT NOT NULL,
  normalized TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_type, subject_id, normalized)
);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_subject_names_trgm ON credit_sanctions_subject_names USING GIN (normalized gin_trgm_ops);

-- Candidate matches behind a screening (evidence for the reviewer).
CREATE TABLE IF NOT EXISTS credit_sanctions_screening_matches (
  id BIGSERIAL PRIMARY KEY,
  screening_id UUID NOT NULL REFERENCES oxsteed_credit_sanctions_screenings(id) ON DELETE CASCADE,
  source_id VARCHAR(40) NOT NULL,
  version_id UUID,
  entry_id BIGINT,
  external_id TEXT NOT NULL,
  query_name TEXT NOT NULL,
  matched_name TEXT NOT NULL,
  score NUMERIC(5, 4) NOT NULL,
  entry_type VARCHAR(20),
  programs TEXT[] NOT NULL DEFAULT '{}',
  countries TEXT[] NOT NULL DEFAULT '{}',
  birth_dates TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_sanctions_matches_screening ON credit_sanctions_screening_matches (screening_id);

ALTER TABLE oxsteed_credit_sanctions_screenings
  ADD COLUMN IF NOT EXISTS list_versions JSONB,
  ADD COLUMN IF NOT EXISTS trigger_reason VARCHAR(40),
  ADD COLUMN IF NOT EXISTS screened_name TEXT,
  ADD COLUMN IF NOT EXISTS top_score NUMERIC(5, 4),
  -- A hit an administrator confirmed as a true match stays blocking: later
  -- automated rescreens can never replace it with a 'clear'.
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Counterparty screenings (payout account holders, free names) use their own
-- subject type; the id is a stable hash of the normalised name.
ALTER TABLE oxsteed_credit_sanctions_screenings DROP CONSTRAINT IF EXISTS oxsteed_credit_sanctions_screenings_subject_type_check;
ALTER TABLE oxsteed_credit_sanctions_screenings
  ADD CONSTRAINT oxsteed_credit_sanctions_screenings_subject_type_check
  CHECK (subject_type IN ('customer', 'partner', 'counterparty'));

-- Screening request outbox. Written by triggers (signup, name change, card
-- payment capture, tips) so no application hot path gains a query; the
-- oversight worker drains it.
CREATE TABLE IF NOT EXISTS credit_sanctions_screening_requests (
  id BIGSERIAL PRIMARY KEY,
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('customer', 'partner')),
  subject_id TEXT NOT NULL,
  reason VARCHAR(40) NOT NULL,
  source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  outcome VARCHAR(30)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_sanctions_request_open
  ON credit_sanctions_screening_requests (subject_type, subject_id) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION credit_sanctions_enqueue(p_subject_type TEXT, p_subject_id TEXT, p_reason TEXT, p_ref TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_subject_id IS NULL THEN RETURN; END IF;
  INSERT INTO credit_sanctions_screening_requests (subject_type, subject_id, reason, source_ref)
  VALUES (p_subject_type, p_subject_id, p_reason, p_ref)
  ON CONFLICT (subject_type, subject_id) WHERE processed_at IS NULL DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  -- Never break signup or payments because the outbox write failed; the
  -- periodic population sweep re-enqueues unscreened subjects.
  RAISE WARNING 'credit_sanctions_enqueue failed: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION credit_sanctions_users_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM credit_sanctions_enqueue('customer', NEW.id::text, 'signup', NULL);
  ELSIF NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name OR NEW.country IS DISTINCT FROM OLD.country THEN
    PERFORM credit_sanctions_enqueue('customer', NEW.id::text, 'profile_change', NULL);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_credit_sanctions_users ON users;
CREATE TRIGGER trg_credit_sanctions_users
  AFTER INSERT OR UPDATE OF first_name, last_name, country ON users
  FOR EACH ROW EXECUTE FUNCTION credit_sanctions_users_trigger();

CREATE OR REPLACE FUNCTION credit_sanctions_payments_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.captured_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.captured_at IS NULL) THEN
    PERFORM credit_sanctions_enqueue('customer', NEW.payer_id::text, 'payment_capture', 'payment:' || NEW.id);
    PERFORM credit_sanctions_enqueue('customer', NEW.payee_id::text, 'payment_capture', 'payment:' || NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_credit_sanctions_payments ON payments;
CREATE TRIGGER trg_credit_sanctions_payments
  AFTER INSERT OR UPDATE OF captured_at ON payments
  FOR EACH ROW EXECUTE FUNCTION credit_sanctions_payments_trigger();

CREATE OR REPLACE FUNCTION credit_sanctions_tips_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM credit_sanctions_enqueue('customer', NEW.customer_id::text, 'tip', 'tip:' || NEW.id);
  PERFORM credit_sanctions_enqueue('customer', NEW.helper_id::text, 'tip', 'tip:' || NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_credit_sanctions_tips ON job_tips;
CREATE TRIGGER trg_credit_sanctions_tips
  AFTER INSERT ON job_tips
  FOR EACH ROW EXECUTE FUNCTION credit_sanctions_tips_trigger();
