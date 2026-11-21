-- Group 9 Slice A (items 452-454): driver-owned vehicles and driver documents.
--
-- 452: delivery_vehicles gains a driver owner (owner_user_id) plus vehicle
-- identity (plate/make/model/year). Ops fleet rows keep owner_user_id NULL.
-- delivery_driver_profiles gains active_vehicle_id, the driver's chosen
-- vehicle, shown on the profile. 453: driver_documents records the
-- documents a driver owns (licence, insurance, registration) with expiry
-- dates; the renewal-reminder job stamps one column per window (30/7/1
-- days) so a reminder is sent at most once per window. 454: any
-- self-serve profile whose service_area was stored as a bare JSON string
-- (the pre-fix onboarding bug) is reset to '{}' (everywhere), matching
-- what areaCovers already does for an empty object.
BEGIN;

ALTER TABLE delivery_vehicles
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plate VARCHAR(32),
  ADD COLUMN IF NOT EXISTS make VARCHAR(80),
  ADD COLUMN IF NOT EXISTS model VARCHAR(80),
  ADD COLUMN IF NOT EXISTS year INTEGER CHECK (year IS NULL OR (year >= 1900 AND year <= 2100));
CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_owner ON delivery_vehicles(owner_user_id) WHERE owner_user_id IS NOT NULL;

ALTER TABLE delivery_driver_profiles
  ADD COLUMN IF NOT EXISTS active_vehicle_id BIGINT REFERENCES delivery_vehicles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS driver_documents (
  id BIGSERIAL PRIMARY KEY,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(32) NOT NULL CHECK (document_type IN ('license', 'insurance', 'registration', 'vehicle_registration', 'other')),
  title VARCHAR(160) NOT NULL,
  expires_at TIMESTAMPTZ,
  notes TEXT,
  reminder_30_sent_at TIMESTAMPTZ,
  reminder_7_sent_at TIMESTAMPTZ,
  reminder_1_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON driver_documents(driver_user_id, expires_at);

-- Pre-fix self-serve onboarding stored the free-text service area as a JSON
-- string; areaCovers rejects non-objects, so those profiles could never
-- pass the service-area gate. A bare string carries no usable area, so it
-- becomes '{}' (everywhere), the same as a profile with no area set.
UPDATE delivery_driver_profiles
   SET service_area = '{}'::jsonb
 WHERE jsonb_typeof(service_area) = 'string';

COMMIT;
