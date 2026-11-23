-- Groups 5-6 items 236-237: service-business locations and launch checklists.
-- Restaurants keep restaurant_locations; these rows are for service businesses.
CREATE TABLE IF NOT EXISTS business_service_locations (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  address_street TEXT, address_city TEXT, address_state TEXT, address_zip TEXT,
  phone TEXT,
  timezone TEXT,
  hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','active','paused','closed')),
  launched_at TIMESTAMPTZ,
  launched_by UUID REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_service_locations_name_uq ON business_service_locations (business_id, LOWER(name)) WHERE status <> 'closed';
CREATE TABLE IF NOT EXISTS business_service_location_members (
  location_id BIGINT NOT NULL REFERENCES business_service_locations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, user_id)
);
CREATE TABLE IF NOT EXISTS business_service_location_services (
  location_id BIGINT NOT NULL REFERENCES business_service_locations(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  PRIMARY KEY (location_id, service_id)
);
CREATE TABLE IF NOT EXISTS business_location_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES business_service_locations(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_location_checklist_items_loc ON business_location_checklist_items (location_id);
