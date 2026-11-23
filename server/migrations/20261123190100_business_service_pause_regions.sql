-- Groups 5-6 items 207 (regional offering rules) and 210 (service pause).
-- Additive and idempotent. A pause stops customer bookings until resumed or
-- until paused_until passes; region rules limit where customers can book.
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS pause_reason TEXT;
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS region_mode TEXT NOT NULL DEFAULT 'everywhere';
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS region_states TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS region_postal_prefixes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE business_services ADD COLUMN IF NOT EXISTS offering_version INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE business_services ADD CONSTRAINT business_services_region_mode_check CHECK (region_mode IN ('everywhere','only','except'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS business_service_offering_history (
  id BIGSERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK (event IN ('paused','resumed','regions_changed')),
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_service_offering_history_service ON business_service_offering_history (service_id, id DESC);
