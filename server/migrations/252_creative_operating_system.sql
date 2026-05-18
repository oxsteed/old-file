-- Migration 252: Creative operating system
-- Photographer / creative studio / graphic design templates need structured
-- intake, package, approval, and delivery workflows.

BEGIN;

CREATE TABLE IF NOT EXISTS creative_operation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  response_promise_hours INTEGER NOT NULL DEFAULT 12,
  discovery_call_label VARCHAR(120) NOT NULL DEFAULT 'Creative discovery intake',
  delivery_window_days INTEGER NOT NULL DEFAULT 14,
  approval_turnaround_hours INTEGER NOT NULL DEFAULT 48,
  revision_policy TEXT,
  approval_policy TEXT,
  follow_up_prompt TEXT,
  testimonial_prompt TEXT,
  gallery_focus_tags TEXT[] NOT NULL DEFAULT ARRAY['Brand work', 'Sessions', 'Before/after'],
  deliverable_types TEXT[] NOT NULL DEFAULT ARRAY['Concepts', 'Final assets', 'Retouched images'],
  trust_artifacts TEXT[] NOT NULL DEFAULT ARRAY['Clear revision policy', 'Approval checkpoints', 'Commercial-use clarity'],
  preferred_contact_channel VARCHAR(30) NOT NULL DEFAULT 'email'
    CHECK (preferred_contact_channel IN ('email', 'call', 'meeting', 'message')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creative_intake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_quote_id BIGINT REFERENCES business_quotes(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'discovery_scheduled', 'proposal_sent', 'active', 'in_review', 'approved', 'delivered', 'archived')),
  workflow_stage VARCHAR(32) NOT NULL DEFAULT 'intake'
    CHECK (workflow_stage IN ('intake', 'discovery', 'proposal', 'production', 'review', 'delivery', 'follow_up', 'closed')),
  template_slug VARCHAR(60) NOT NULL DEFAULT 'creative_studio',
  project_type VARCHAR(180) NOT NULL,
  project_goal TEXT,
  style_direction TEXT,
  deadline_notes VARCHAR(255),
  asset_needs TEXT,
  revision_scope VARCHAR(255),
  package_interest VARCHAR(180),
  budget_notes VARCHAR(255),
  contact_name VARCHAR(160),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(60),
  preferred_contact_channel VARCHAR(30),
  reference_links TEXT[] NOT NULL DEFAULT '{}',
  photo_urls TEXT[] NOT NULL DEFAULT '{}',
  internal_notes TEXT,
  customer_visible_note TEXT,
  follow_up_due_at TIMESTAMPTZ,
  delivery_target_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_intake_requests_business
  ON creative_intake_requests (business_id, status, workflow_stage, created_at DESC);

CREATE TABLE IF NOT EXISTS creative_project_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  package_name VARCHAR(180) NOT NULL,
  package_type VARCHAR(30) NOT NULL DEFAULT 'project'
    CHECK (package_type IN ('session', 'project', 'campaign', 'retainer')),
  target_templates TEXT[] NOT NULL DEFAULT ARRAY['creative_studio'],
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  revision_rounds INTEGER,
  deliverables TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_project_packages_business
  ON creative_project_packages (business_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS creative_approval_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  intake_request_id UUID REFERENCES creative_intake_requests(id) ON DELETE CASCADE,
  record_type VARCHAR(40) NOT NULL
    CHECK (record_type IN ('brief', 'proof', 'approval', 'delivery', 'usage_rights', 'testimonial')),
  title VARCHAR(180) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'revisions_requested', 'delivered', 'archived')),
  due_at TIMESTAMPTZ,
  asset_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_approval_records_business
  ON creative_approval_records (business_id, status, due_at);

COMMIT;
