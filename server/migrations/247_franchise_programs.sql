-- Migration 247: Franchise program management
-- Supports global franchise applications, agreements, launch checklist,
-- territory planning, and conversion into live OxSteed business stores.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS franchise_programs (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  default_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  initial_fee_cents INTEGER NOT NULL DEFAULT 0,
  royalty_bps INTEGER NOT NULL DEFAULT 0,
  marketing_fee_bps INTEGER NOT NULL DEFAULT 0,
  term_years INTEGER NOT NULL DEFAULT 5,
  renewal_term_years INTEGER NOT NULL DEFAULT 5,
  territory_policy TEXT,
  training_summary TEXT,
  support_summary TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO franchise_programs (
  code,
  name,
  description,
  default_currency,
  initial_fee_cents,
  royalty_bps,
  marketing_fee_bps,
  term_years,
  renewal_term_years,
  territory_policy,
  training_summary,
  support_summary
) VALUES (
  'oxsteed-global',
  'OxSteed Global Franchise Program',
  'Default program for evaluating, approving, and launching franchise stores in any supported country.',
  'USD',
  2500000,
  600,
  200,
  5,
  5,
  'Territories are reviewed case-by-case by country, region, and launch density.',
  'Includes launch planning, operations enablement, support playbooks, and local-market setup.',
  'Includes onboarding, launch readiness reviews, and post-opening operational support.'
)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  default_currency = EXCLUDED.default_currency,
  initial_fee_cents = EXCLUDED.initial_fee_cents,
  royalty_bps = EXCLUDED.royalty_bps,
  marketing_fee_bps = EXCLUDED.marketing_fee_bps,
  term_years = EXCLUDED.term_years,
  renewal_term_years = EXCLUDED.renewal_term_years,
  territory_policy = EXCLUDED.territory_policy,
  training_summary = EXCLUDED.training_summary,
  support_summary = EXCLUDED.support_summary,
  is_active = TRUE,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS franchise_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id BIGINT NOT NULL REFERENCES franchise_programs(id) ON DELETE RESTRICT,
  applicant_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_consulting_request_id UUID REFERENCES consulting_requests(id) ON DELETE SET NULL,
  linked_business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(40),
  lead_source VARCHAR(100),
  current_company_name VARCHAR(255),
  desired_brand_name VARCHAR(255),
  desired_country VARCHAR(2) NOT NULL,
  desired_region VARCHAR(120),
  desired_city VARCHAR(120),
  territory_summary TEXT,
  business_background TEXT,
  operations_background TEXT,
  local_market_overview TEXT,
  available_capital_cents BIGINT,
  liquid_capital_cents BIGINT,
  preferred_store_count INTEGER NOT NULL DEFAULT 1,
  timeline_window VARCHAR(80),
  status VARCHAR(40) NOT NULL DEFAULT 'inquiry'
    CHECK (status IN ('inquiry', 'screening', 'application_review', 'diligence', 'agreement_pending', 'approved', 'rejected', 'archived', 'launched')),
  agreement_status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (agreement_status IN ('draft', 'sent', 'signed', 'waived')),
  training_status VARCHAR(30) NOT NULL DEFAULT 'not_started'
    CHECK (training_status IN ('not_started', 'scheduled', 'in_progress', 'completed')),
  launch_readiness_status VARCHAR(30) NOT NULL DEFAULT 'not_ready'
    CHECK (launch_readiness_status IN ('not_ready', 'planning', 'ready', 'launched')),
  market_assessment TEXT,
  hq_recommendation TEXT,
  risk_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  launched_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_applications_status
  ON franchise_applications(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_applications_country
  ON franchise_applications(desired_country, desired_region);
CREATE INDEX IF NOT EXISTS idx_franchise_applications_business
  ON franchise_applications(linked_business_id);
CREATE INDEX IF NOT EXISTS idx_franchise_applications_owner
  ON franchise_applications(owner_user_id);

CREATE TABLE IF NOT EXISTS franchise_application_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  label VARCHAR(255) NOT NULL,
  owner_role VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'waived')),
  notes TEXT,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, code)
);

CREATE INDEX IF NOT EXISTS idx_franchise_checklist_application
  ON franchise_application_checklist_items(application_id, sort_order, id);

CREATE TABLE IF NOT EXISTS franchise_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL UNIQUE REFERENCES franchise_applications(id) ON DELETE CASCADE,
  agreement_version VARCHAR(80),
  document_url TEXT,
  initial_fee_cents INTEGER,
  royalty_bps INTEGER,
  marketing_fee_bps INTEGER,
  territory_exclusive BOOLEAN NOT NULL DEFAULT FALSE,
  term_years INTEGER,
  signed_by_name VARCHAR(255),
  signed_by_email VARCHAR(255),
  signed_at TIMESTAMPTZ,
  countersigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  countersigned_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS franchise_application_notes (
  id BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal', 'shared')),
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_notes_application
  ON franchise_application_notes(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS franchise_activity_log (
  id BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  event_summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_activity_application
  ON franchise_activity_log(application_id, created_at DESC);
