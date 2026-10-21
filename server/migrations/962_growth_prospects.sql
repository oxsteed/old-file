-- D23: licensed prospect data is isolated from user activity and requires
-- provenance, suppression, license scope, and explicit country outreach.
CREATE TABLE IF NOT EXISTS prospect_businesses (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  country CHAR(2) NOT NULL,
  region TEXT,
  postal_code TEXT,
  license_ref TEXT NOT NULL,
  license_expires_at DATE,
  provenance JSONB NOT NULL,
  outreach_country CHAR(2),
  outreach_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  outreach_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (outreach_status IN ('not_started','eligible','suppressed','contacted','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source,source_record_id)
);
CREATE INDEX IF NOT EXISTS prospect_businesses_country_idx
  ON prospect_businesses(country,region,postal_code);
CREATE TABLE IF NOT EXISTS prospect_suppressions (
  id BIGSERIAL PRIMARY KEY,
  source TEXT,
  source_record_id TEXT,
  normalized_name TEXT,
  country CHAR(2),
  reason TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_record_id IS NOT NULL OR normalized_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS prospect_suppressions_lookup_idx
  ON prospect_suppressions(source,source_record_id,country,normalized_name);
