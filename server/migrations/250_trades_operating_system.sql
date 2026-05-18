-- Migration 250: Trades operating system
-- Shared operating layer for trades_pro, electrician, and auto_mechanic templates.

BEGIN;

CREATE TABLE IF NOT EXISTS trades_operation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  diagnostics_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  emergency_service_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  response_promise_hours INTEGER NOT NULL DEFAULT 12,
  estimate_turnaround_hours INTEGER NOT NULL DEFAULT 24,
  booking_style VARCHAR(24) NOT NULL DEFAULT 'diagnostic_first'
    CHECK (booking_style IN ('diagnostic_first', 'quote_first', 'direct_service')),
  primary_quote_label VARCHAR(120) NOT NULL DEFAULT 'Diagnostic and estimate',
  supported_issue_types TEXT[] NOT NULL DEFAULT ARRAY[
    'System failure',
    'Safety concern',
    'Intermittent issue',
    'Install or replacement',
    'Maintenance request'
  ],
  service_asset_types TEXT[] NOT NULL DEFAULT ARRAY['Residential', 'Commercial', 'Vehicle'],
  trust_artifacts TEXT[] NOT NULL DEFAULT ARRAY[
    'Licensed or certified work',
    'Documented diagnostics',
    'Written recommendations'
  ],
  dispatch_notes TEXT,
  intake_instructions TEXT,
  emergency_phone VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trades_diagnostic_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_quote_id BIGINT REFERENCES business_quotes(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'scheduled', 'diagnosing', 'quoted', 'approved', 'completed', 'declined', 'cancelled')),
  workflow_stage VARCHAR(32) NOT NULL DEFAULT 'intake'
    CHECK (workflow_stage IN ('intake', 'triage', 'visit_scheduled', 'diagnostic', 'estimate', 'repair', 'closed')),
  request_channel VARCHAR(24) NOT NULL DEFAULT 'public_profile'
    CHECK (request_channel IN ('public_profile', 'phone', 'message', 'internal')),
  template_slug VARCHAR(60) NOT NULL DEFAULT 'trades_pro',
  urgency VARCHAR(24) NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('emergency', 'urgent', 'normal', 'low')),
  issue_type VARCHAR(120) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  contact_name VARCHAR(160),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(60),
  service_address TEXT,
  preferred_times TEXT,
  asset_label VARCHAR(200),
  asset_year VARCHAR(20),
  vin VARCHAR(32),
  mileage VARCHAR(40),
  safety_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  symptoms_started_at VARCHAR(160),
  current_status_note TEXT,
  internal_notes TEXT,
  photo_urls TEXT[] NOT NULL DEFAULT '{}',
  template_intake JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostic_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (diagnostic_fee_cents >= 0),
  estimated_repair_cents INTEGER CHECK (estimated_repair_cents >= 0),
  sla_target_at TIMESTAMPTZ,
  follow_up_due_at TIMESTAMPTZ,
  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_diagnostic_requests_business
  ON trades_diagnostic_requests (business_id, status, workflow_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trades_diagnostic_requests_follow_up
  ON trades_diagnostic_requests (business_id, follow_up_due_at)
  WHERE follow_up_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS trades_service_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  diagnostic_request_id UUID REFERENCES trades_diagnostic_requests(id) ON DELETE CASCADE,
  quote_id BIGINT REFERENCES business_quotes(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  recommendation_type VARCHAR(40) NOT NULL DEFAULT 'repair'
    CHECK (recommendation_type IN ('repair', 'upgrade', 'maintenance', 'replacement', 'safety')),
  priority VARCHAR(24) NOT NULL DEFAULT 'recommended'
    CHECK (priority IN ('critical', 'recommended', 'optional')),
  description TEXT,
  estimated_cents INTEGER CHECK (estimated_cents >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'quoted', 'approved', 'completed', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_service_recommendations_business
  ON trades_service_recommendations (business_id, status, priority, created_at DESC);

CREATE TABLE IF NOT EXISTS trades_trust_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  record_type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  issuer VARCHAR(180),
  status VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expiring', 'expired', 'archived')),
  expires_on DATE,
  document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_trust_records_business
  ON trades_trust_records (business_id, status, expires_on);

COMMIT;
