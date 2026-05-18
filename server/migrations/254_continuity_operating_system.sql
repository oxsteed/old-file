-- Migration 254: Continuity operating system
-- Health, care, and education templates need guided intake, continuity plans,
-- trust records, and recurring follow-up beyond generic appointment booking.

BEGIN;

CREATE TABLE IF NOT EXISTS continuity_operation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  response_promise_hours INTEGER NOT NULL DEFAULT 12,
  intake_label VARCHAR(120) NOT NULL DEFAULT 'Guided intake and continuity planning',
  follow_up_window_days INTEGER NOT NULL DEFAULT 14,
  next_session_window_days INTEGER NOT NULL DEFAULT 14,
  preferred_contact_channel VARCHAR(30) NOT NULL DEFAULT 'message'
    CHECK (preferred_contact_channel IN ('message', 'email', 'call', 'text', 'meeting')),
  intake_focuses TEXT[] NOT NULL DEFAULT ARRAY['Goals and concerns', 'Recurring cadence', 'Progress checkpoints'],
  trust_artifacts TEXT[] NOT NULL DEFAULT ARRAY['Clear expectations', 'Safety-aware intake', 'Progress-minded follow-up'],
  plan_focuses TEXT[] NOT NULL DEFAULT ARRAY['Session packs', 'Memberships', 'Recurring support'],
  progress_prompts TEXT[] NOT NULL DEFAULT ARRAY['Next-step recommendation', 'Progress reflection', 'Retention follow-up'],
  consent_requirements TEXT[] NOT NULL DEFAULT ARRAY['Intake acknowledgement', 'Communication preferences'],
  guardian_policy TEXT,
  prep_expectations TEXT,
  continuity_pitch TEXT,
  emergency_contact_phone VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS continuity_intake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_appointment_id UUID REFERENCES business_appointments(id) ON DELETE SET NULL,
  assigned_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'qualified', 'scheduled', 'active', 'progress_review', 'continuing', 'completed', 'paused', 'cancelled')),
  workflow_stage VARCHAR(32) NOT NULL DEFAULT 'intake'
    CHECK (workflow_stage IN ('intake', 'qualification', 'scheduling', 'session', 'progress', 'retention', 'closed')),
  template_slug VARCHAR(60) NOT NULL DEFAULT 'wellness_therapy',
  relationship_type VARCHAR(40) NOT NULL DEFAULT 'client'
    CHECK (relationship_type IN ('client', 'student', 'family', 'pet', 'patient', 'athlete')),
  primary_goal VARCHAR(180) NOT NULL,
  support_context TEXT,
  schedule_notes VARCHAR(255),
  package_interest VARCHAR(180),
  age_or_level VARCHAR(120),
  guardian_name VARCHAR(160),
  guardian_phone VARCHAR(60),
  special_considerations TEXT,
  current_routine TEXT,
  progress_target TEXT,
  budget_notes VARCHAR(255),
  contact_name VARCHAR(160),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(60),
  preferred_contact_channel VARCHAR(30),
  consent_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  internal_notes TEXT,
  customer_visible_note TEXT,
  follow_up_due_at TIMESTAMPTZ,
  next_session_recommended_at TIMESTAMPTZ,
  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_continuity_intake_requests_business
  ON continuity_intake_requests (business_id, status, workflow_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_continuity_intake_requests_follow_up
  ON continuity_intake_requests (business_id, follow_up_due_at)
  WHERE follow_up_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS continuity_service_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_name VARCHAR(180) NOT NULL,
  plan_type VARCHAR(32) NOT NULL DEFAULT 'membership'
    CHECK (plan_type IN ('session_pack', 'membership', 'care_plan', 'learning_plan', 'wellness_plan')),
  target_templates TEXT[] NOT NULL DEFAULT ARRAY['wellness_therapy'],
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  session_count INTEGER,
  cadence_label VARCHAR(120),
  focus_areas TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_continuity_service_plans_business
  ON continuity_service_plans (business_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS continuity_trust_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  record_type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expiring', 'expired', 'archived')),
  issuer VARCHAR(180),
  expires_on DATE,
  document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_continuity_trust_records_business
  ON continuity_trust_records (business_id, status, expires_on);

COMMIT;
