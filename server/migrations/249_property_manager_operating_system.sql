-- Migration 249: Property manager operating system
-- Turns the property_manager template into a backend-backed workflow surface.

BEGIN;

CREATE TABLE IF NOT EXISTS property_operation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  intake_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  emergency_phone VARCHAR(60),
  emergency_instructions TEXT,
  after_hours_policy TEXT,
  response_promise_hours INTEGER NOT NULL DEFAULT 24,
  follow_up_interval_hours INTEGER NOT NULL DEFAULT 24,
  default_bill_to VARCHAR(24) NOT NULL DEFAULT 'owner'
    CHECK (default_bill_to IN ('owner', 'tenant', 'hoa', 'internal')),
  supported_issue_categories TEXT[] NOT NULL DEFAULT ARRAY[
    'Plumbing',
    'Electrical',
    'Appliance',
    'Heating / Cooling',
    'Doors / Locks',
    'Pest concern',
    'Safety concern',
    'General repair'
  ],
  trust_artifacts TEXT[] NOT NULL DEFAULT ARRAY[
    'Insured vendors',
    'Documented repair history',
    'Tenant-visible updates'
  ],
  managed_property_types TEXT[] NOT NULL DEFAULT ARRAY['Apartment', 'Single-family', 'Multi-unit'],
  service_area_notes TEXT,
  tenant_portal_intro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_portfolio_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  property_label VARCHAR(200) NOT NULL,
  unit_label VARCHAR(100),
  property_type VARCHAR(80) NOT NULL DEFAULT 'Apartment',
  occupancy_status VARCHAR(32) NOT NULL DEFAULT 'occupied'
    CHECK (occupancy_status IN ('occupied', 'vacant', 'turnover', 'owner_hold')),
  contact_name VARCHAR(160),
  contact_phone VARCHAR(60),
  contact_email VARCHAR(255),
  access_summary TEXT,
  priority_tier VARCHAR(24) NOT NULL DEFAULT 'standard'
    CHECK (priority_tier IN ('standard', 'priority', 'vip')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_portfolio_units_business
  ON property_portfolio_units (business_id, property_label, unit_label);

CREATE TABLE IF NOT EXISTS property_management_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  pricing_model VARCHAR(32) NOT NULL DEFAULT 'flat'
    CHECK (pricing_model IN ('flat', 'hourly', 'inspection', 'turnover', 'retainer')),
  bill_to_party VARCHAR(24) NOT NULL DEFAULT 'owner'
    CHECK (bill_to_party IN ('owner', 'tenant', 'hoa', 'internal')),
  base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0),
  after_hours_surcharge_cents INTEGER NOT NULL DEFAULT 0 CHECK (after_hours_surcharge_cents >= 0),
  target_turnaround_hours INTEGER,
  includes JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_management_packages_business
  ON property_management_packages (business_id, is_active, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS property_compliance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES property_portfolio_units(id) ON DELETE SET NULL,
  record_type VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'complete', 'overdue')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  vendor_name VARCHAR(180),
  document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_compliance_records_business
  ON property_compliance_records (business_id, status, due_date);

ALTER TABLE property_maintenance_requests
  ADD COLUMN IF NOT EXISTS workflow_stage VARCHAR(32) NOT NULL DEFAULT 'intake'
    CHECK (workflow_stage IN ('intake', 'triage', 'dispatch', 'scheduled', 'repair', 'follow_up', 'closed')),
  ADD COLUMN IF NOT EXISTS intake_channel VARCHAR(32) NOT NULL DEFAULT 'tenant_portal'
    CHECK (intake_channel IN ('tenant_portal', 'phone', 'email', 'internal')),
  ADD COLUMN IF NOT EXISTS billable_party VARCHAR(24)
    CHECK (billable_party IN ('owner', 'tenant', 'hoa', 'internal')),
  ADD COLUMN IF NOT EXISTS template_intake JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sla_target_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_property_maintenance_workflow_stage
  ON property_maintenance_requests (business_id, workflow_stage, status, follow_up_due_at);

CREATE INDEX IF NOT EXISTS idx_property_maintenance_sla_target
  ON property_maintenance_requests (business_id, sla_target_at)
  WHERE sla_target_at IS NOT NULL;

COMMIT;
