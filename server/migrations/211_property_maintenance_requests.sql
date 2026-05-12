-- Migration 211: Property maintenance requests
-- Dedicated workflow for property-manager templates.

CREATE TABLE IF NOT EXISTS property_maintenance_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

  status VARCHAR(32) NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'accepted', 'scheduled', 'assigned', 'in_progress', 'completed', 'rejected', 'cancelled')),
  urgency VARCHAR(32) NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('emergency', 'urgent', 'normal', 'low')),

  issue_category VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  property_label VARCHAR(200),
  unit_label VARCHAR(100),
  access_notes TEXT,
  preferred_times TEXT,
  permission_to_enter BOOLEAN NOT NULL DEFAULT FALSE,
  contact_name VARCHAR(160),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(60),
  photo_urls TEXT[] NOT NULL DEFAULT '{}',

  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,
  estimated_cost NUMERIC(12,2),
  actual_cost NUMERIC(12,2),
  vendor_name VARCHAR(180),
  owner_notes TEXT,
  tenant_visible_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_maintenance_business_status
  ON property_maintenance_requests (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_maintenance_requester
  ON property_maintenance_requests (requester_id, created_at DESC)
  WHERE requester_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_maintenance_assigned_helper
  ON property_maintenance_requests (assigned_helper_id, status, scheduled_start_at)
  WHERE assigned_helper_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS property_maintenance_request_events (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES property_maintenance_requests(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(60) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_maintenance_events_request
  ON property_maintenance_request_events (request_id, created_at ASC);
