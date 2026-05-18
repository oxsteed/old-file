-- Migration 251: Beauty operating system
-- Beauty / barber / stylist / spa templates need intake, retention, and trust
-- workflows beyond generic appointments.

BEGIN;

CREATE TABLE IF NOT EXISTS beauty_operation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  response_promise_hours INTEGER NOT NULL DEFAULT 6,
  consultation_offer_label VARCHAR(120) NOT NULL DEFAULT 'Beauty intake and appointment planning',
  rebook_window_days INTEGER NOT NULL DEFAULT 42,
  same_day_fill_window_hours INTEGER NOT NULL DEFAULT 6,
  deposit_policy TEXT,
  cancellation_policy TEXT,
  prep_instructions TEXT,
  aftercare_prompt TEXT,
  membership_pitch TEXT,
  preferred_contact_channel VARCHAR(30) NOT NULL DEFAULT 'text'
    CHECK (preferred_contact_channel IN ('text', 'email', 'call', 'dm')),
  service_focuses TEXT[] NOT NULL DEFAULT ARRAY['Routine appointments', 'Transformations', 'Maintenance visits'],
  concern_tags TEXT[] NOT NULL DEFAULT ARRAY['Color correction', 'Sensitive skin', 'Beard shaping', 'Bridal prep'],
  trust_artifacts TEXT[] NOT NULL DEFAULT ARRAY['Licensed professionals', 'Patch-test aware process', 'Clear no-show and prep expectations'],
  consent_requirements TEXT[] NOT NULL DEFAULT ARRAY['Prep acknowledgement', 'Cancellation acknowledgement'],
  emergency_contact_phone VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beauty_intake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_appointment_id UUID REFERENCES business_appointments(id) ON DELETE SET NULL,
  assigned_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'consultation_ready', 'booked', 'confirmed', 'in_service', 'completed', 'rebooked', 'no_show', 'cancelled')),
  workflow_stage VARCHAR(32) NOT NULL DEFAULT 'intake'
    CHECK (workflow_stage IN ('intake', 'consultation', 'booking', 'prep', 'visit', 'follow_up', 'closed')),
  template_slug VARCHAR(60) NOT NULL DEFAULT 'beauty_style',
  client_segment VARCHAR(40) NOT NULL DEFAULT 'new'
    CHECK (client_segment IN ('new', 'returning', 'vip', 'bridal', 'membership')),
  desired_service VARCHAR(180) NOT NULL,
  desired_look VARCHAR(255),
  preferred_staff VARCHAR(180),
  preferred_time_notes TEXT,
  package_interest VARCHAR(180),
  budget_notes VARCHAR(255),
  contact_name VARCHAR(160),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(60),
  inspiration_notes TEXT,
  hair_length VARCHAR(120),
  hair_history TEXT,
  beard_preferences TEXT,
  skin_sensitivities TEXT,
  contraindications TEXT,
  prep_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  no_show_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  consent_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  photo_urls TEXT[] NOT NULL DEFAULT '{}',
  internal_notes TEXT,
  customer_visible_note TEXT,
  follow_up_due_at TIMESTAMPTZ,
  rebook_recommended_at TIMESTAMPTZ,
  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beauty_intake_requests_business
  ON beauty_intake_requests (business_id, status, workflow_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_beauty_intake_requests_follow_up
  ON beauty_intake_requests (business_id, follow_up_due_at)
  WHERE follow_up_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS beauty_membership_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  package_name VARCHAR(180) NOT NULL,
  package_type VARCHAR(30) NOT NULL DEFAULT 'membership'
    CHECK (package_type IN ('single', 'series', 'membership', 'bridal')),
  target_templates TEXT[] NOT NULL DEFAULT ARRAY['beauty_style'],
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  sessions_included INTEGER,
  perks TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beauty_membership_packages_business
  ON beauty_membership_packages (business_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS beauty_trust_records (
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

CREATE INDEX IF NOT EXISTS idx_beauty_trust_records_business
  ON beauty_trust_records (business_id, status, expires_on);

COMMIT;
