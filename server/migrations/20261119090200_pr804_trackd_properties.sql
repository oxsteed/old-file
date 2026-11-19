-- PR #804 ecosystem gap G-17 (property manager cannot separate work by
-- property). Canonical properties table; property_id on maintenance
-- requests and jobs. The free-text property_label / unit_label fields are
-- kept for intake copy and are NOT scoping: only property_id scopes.
-- Invoices and staff remain business-scoped (see Track D report: invoice /
-- staff reads by property are NOT in this migration; listBusinessRequests
-- and convertToJob carry property_id, and the maintenance UI filters by it).

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label VARCHAR(200) NOT NULL,
  address TEXT,
  address_city VARCHAR(120),
  address_state VARCHAR(80),
  address_zip VARCHAR(20),
  address_country VARCHAR(80),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_business_id ON properties (business_id, label);

ALTER TABLE property_maintenance_requests
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_property_maintenance_requests_property_id
  ON property_maintenance_requests (property_id) WHERE property_id IS NOT NULL;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_property_id
  ON jobs (property_id) WHERE property_id IS NOT NULL;
