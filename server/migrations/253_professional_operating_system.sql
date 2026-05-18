-- Migration 253: Professional operating system
-- Shared engagement and compliance workflow for accountant,
-- consulting_coaching, and legal_admin templates.

BEGIN;

CREATE TABLE IF NOT EXISTS professional_operation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  response_promise_hours INTEGER NOT NULL DEFAULT 24,
  consultation_label VARCHAR(120) NOT NULL DEFAULT 'Engagement intake and consultation planning',
  recurring_reminder_days INTEGER NOT NULL DEFAULT 30,
  document_checklist TEXT[] NOT NULL DEFAULT ARRAY['Core documents', 'Scope notes', 'Deadlines'],
  obligation_types TEXT[] NOT NULL DEFAULT ARRAY['Monthly check-in', 'Filing deadline', 'Follow-up review'],
  trust_artifacts TEXT[] NOT NULL DEFAULT ARRAY['Confidentiality-forward process', 'Document discipline', 'Recurring obligation tracking'],
  follow_up_prompt TEXT,
  engagement_policy TEXT,
  preferred_contact_channel VARCHAR(30) NOT NULL DEFAULT 'email'
    CHECK (preferred_contact_channel IN ('email', 'call', 'meeting', 'message')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS professional_engagement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_quote_id BIGINT REFERENCES business_quotes(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'discovery_scheduled', 'proposal_sent', 'active', 'waiting_on_client', 'completed', 'archived')),
  workflow_stage VARCHAR(32) NOT NULL DEFAULT 'intake'
    CHECK (workflow_stage IN ('intake', 'scoping', 'documents', 'delivery', 'follow_up', 'closed')),
  template_slug VARCHAR(60) NOT NULL DEFAULT 'consulting_coaching',
  service_need VARCHAR(180) NOT NULL,
  business_context TEXT,
  timeline_notes VARCHAR(255),
  document_summary TEXT,
  package_interest VARCHAR(180),
  budget_notes VARCHAR(255),
  contact_name VARCHAR(160),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(60),
  preferred_contact_channel VARCHAR(30),
  internal_notes TEXT,
  customer_visible_note TEXT,
  follow_up_due_at TIMESTAMPTZ,
  obligation_due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_engagement_requests_business
  ON professional_engagement_requests (business_id, status, workflow_stage, created_at DESC);

CREATE TABLE IF NOT EXISTS professional_service_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  package_name VARCHAR(180) NOT NULL,
  package_type VARCHAR(30) NOT NULL DEFAULT 'engagement'
    CHECK (package_type IN ('session', 'engagement', 'retainer', 'filing')),
  target_templates TEXT[] NOT NULL DEFAULT ARRAY['consulting_coaching'],
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  cadence_label VARCHAR(120),
  deliverables TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_service_packages_business
  ON professional_service_packages (business_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS professional_compliance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  engagement_request_id UUID REFERENCES professional_engagement_requests(id) ON DELETE CASCADE,
  record_type VARCHAR(40) NOT NULL
    CHECK (record_type IN ('license', 'document', 'deadline', 'deliverable', 'compliance', 'follow_up')),
  title VARCHAR(180) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'completed', 'expired', 'archived')),
  due_at TIMESTAMPTZ,
  document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_compliance_records_business
  ON professional_compliance_records (business_id, status, due_at);

COMMIT;
