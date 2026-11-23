-- Groups 7 (items 301-350): property manager operations. Additive + idempotent.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_type VARCHAR(30);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_reason TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_name VARCHAR(160);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS approval_threshold_cents INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS monthly_budget_cents INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS reserve_target_cents INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS reserve_balance_cents INTEGER;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS notes TEXT;
DO $$ BEGIN
  ALTER TABLE properties ADD CONSTRAINT properties_status_chk CHECK (status IN ('active','archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE property_portfolio_units ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_portfolio_units_property ON property_portfolio_units(property_id);

CREATE TABLE IF NOT EXISTS property_common_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(30) NOT NULL DEFAULT 'other',
  access_notes TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_common_areas_property ON property_common_areas(property_id);

CREATE TABLE IF NOT EXISTS property_staff_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES property_portfolio_units(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  contact_name VARCHAR(160),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(40),
  role VARCHAR(20) NOT NULL CHECK (role IN ('manager','building_staff','coverage','unit_contact')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES users(id) ON DELETE SET NULL,
  end_reason VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR contact_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_property_assign_user ON property_staff_assignments(user_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_property_assign_property ON property_staff_assignments(property_id);

ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES property_maintenance_requests(id) ON DELETE SET NULL;
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES property_portfolio_units(id) ON DELETE SET NULL;
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS common_area_id UUID REFERENCES property_common_areas(id) ON DELETE SET NULL;
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'not_required';
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS approval_amount_cents INTEGER;
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ;
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS approval_decided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ;
ALTER TABLE property_maintenance_requests ADD COLUMN IF NOT EXISTS approval_note TEXT;
CREATE INDEX IF NOT EXISTS idx_pmr_duplicate ON property_maintenance_requests(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pmr_property ON property_maintenance_requests(property_id);

CREATE TABLE IF NOT EXISTS property_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  trade VARCHAR(40) NOT NULL DEFAULT 'general',
  contact_name VARCHAR(160),
  email VARCHAR(255),
  phone VARCHAR(40),
  insurance_expires_on DATE,
  license_number VARCHAR(80),
  status VARCHAR(12) NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending','inactive')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_vendors_biz ON property_vendors(business_id);

CREATE TABLE IF NOT EXISTS property_work_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES property_maintenance_requests(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES property_vendors(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  scope TEXT,
  available_on DATE,
  status VARCHAR(12) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','selected','rejected')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_quotes_request ON property_work_quotes(request_id);

CREATE TABLE IF NOT EXISTS property_work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES property_maintenance_requests(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES property_vendors(id) ON DELETE RESTRICT,
  quote_id UUID REFERENCES property_work_quotes(id) ON DELETE SET NULL,
  number VARCHAR(30) NOT NULL,
  scope TEXT NOT NULL,
  not_to_exceed_cents INTEGER NOT NULL CHECK (not_to_exceed_cents >= 0),
  status VARCHAR(12) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','completed','cancelled')),
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (business_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_work_order_open ON property_work_orders(request_id) WHERE status = 'issued';

CREATE TABLE IF NOT EXISTS property_vendor_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES property_vendors(id) ON DELETE RESTRICT,
  work_order_id UUID REFERENCES property_work_orders(id) ON DELETE SET NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  unit_id UUID REFERENCES property_portfolio_units(id) ON DELETE SET NULL,
  invoice_number VARCHAR(60) NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  match_status VARCHAR(12) NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','over','approved','rejected')),
  match_note TEXT,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, vendor_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS property_entry_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES property_maintenance_requests(id) ON DELETE CASCADE,
  consent VARCHAR(10) CHECK (consent IN ('granted','denied')),
  consent_method VARCHAR(12) CHECK (consent_method IN ('portal','phone','email','in_person','written')),
  consent_given_by VARCHAR(160),
  consent_recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  consent_recorded_at TIMESTAMPTZ,
  offered_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_start TIMESTAMPTZ,
  selected_end TIMESTAMPTZ,
  selected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  occupant_notified_at TIMESTAMPTZ,
  instructions TEXT,
  instructions_expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id)
);

CREATE TABLE IF NOT EXISTS property_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES property_portfolio_units(id) ON DELETE SET NULL,
  label VARCHAR(80) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'in' CHECK (status IN ('in','out','lost')),
  holder_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  holder_name VARCHAR(160),
  checked_out_at TIMESTAMPTZ,
  due_back_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS property_key_events (
  id BIGSERIAL PRIMARY KEY,
  key_id UUID NOT NULL REFERENCES property_keys(id) ON DELETE CASCADE,
  action VARCHAR(12) NOT NULL CHECK (action IN ('check_out','return','lost')),
  holder_name VARCHAR(160),
  request_id UUID REFERENCES property_maintenance_requests(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES property_portfolio_units(id) ON DELETE SET NULL,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('inspection','equipment','seasonal','vendor')),
  title VARCHAR(160) NOT NULL,
  equipment_name VARCHAR(160),
  vendor_id UUID REFERENCES property_vendors(id) ON DELETE SET NULL,
  interval_days INTEGER CHECK (interval_days BETWEEN 1 AND 3660),
  months SMALLINT[],
  next_due_on DATE NOT NULL,
  last_done_on DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  alerted_for DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_schedules_due ON property_maintenance_schedules(business_id, next_due_on) WHERE active;

CREATE TABLE IF NOT EXISTS property_turnovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES property_portfolio_units(id) ON DELETE CASCADE,
  move_out_on DATE,
  move_in_on DATE,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','ready','completed','cancelled')),
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_turnover_open ON property_turnovers(unit_id) WHERE status IN ('open','ready');

CREATE TABLE IF NOT EXISTS property_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES property_portfolio_units(id) ON DELETE SET NULL,
  request_id UUID REFERENCES property_maintenance_requests(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'major' CHECK (severity IN ('minor','major','critical')),
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  relocation_note TEXT,
  relocation_until DATE,
  follow_up_on DATE,
  follow_up_done_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_summary TEXT,
  owner_shared_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_property_incidents_property ON property_incidents(property_id);
