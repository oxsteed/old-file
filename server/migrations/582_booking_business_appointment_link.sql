-- Migration 582: Link booking requests to business appointments
-- Business booking acceptance now creates a business_appointments row (the
-- business calendar's canonical store) instead of polluting the owner's
-- personal appointments table. booking_requests.business_appointment_id
-- preserves that link the same way appointment_id does for helpers.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS business_appointment_id UUID
  REFERENCES business_appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_business_appointment
  ON booking_requests(business_appointment_id)
  WHERE business_appointment_id IS NOT NULL;

COMMENT ON COLUMN booking_requests.business_appointment_id
  IS 'Linked business_appointments row (created on accept of a business booking request).';
