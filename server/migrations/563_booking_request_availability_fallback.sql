-- Booking requests can be sent when a provider has not published availability.
-- The request still expires after the normal confirmation window; customers may
-- opt into automatically publishing a public job when the 72 hour window ends.

BEGIN;

ALTER TABLE booking_requests
  ALTER COLUMN requested_start_time DROP NOT NULL,
  ALTER COLUMN requested_end_time DROP NOT NULL;

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS availability_mode VARCHAR(24) NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS auto_post_on_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketplace_posted_at TIMESTAMPTZ;

ALTER TABLE booking_requests
  DROP CONSTRAINT IF EXISTS booking_requests_availability_mode_check;

ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_availability_mode_check
  CHECK (availability_mode IN ('scheduled', 'request_only'));

COMMENT ON COLUMN booking_requests.availability_mode IS
  'scheduled when published slots were selected; request_only when the provider has not published availability.';
COMMENT ON COLUMN booking_requests.auto_post_on_expiry IS
  'For request_only bookings, publish a public job when the 72 hour confirmation window expires.';
COMMENT ON COLUMN booking_requests.marketplace_posted_at IS
  'Timestamp at which the request was automatically converted into a public marketplace job.';

CREATE INDEX IF NOT EXISTS idx_booking_requests_auto_post_expiry
  ON booking_requests(expires_at)
  WHERE status = 'pending' AND auto_post_on_expiry = TRUE;

COMMIT;
