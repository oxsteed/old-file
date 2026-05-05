-- Booking requests: configurable confirmation window + statuses for post-accept cancellation

BEGIN;

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS confirmation_hours INTEGER NOT NULL DEFAULT 24;

ALTER TABLE booking_requests
  DROP CONSTRAINT IF EXISTS booking_requests_confirmation_hours_check;

ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_confirmation_hours_check
  CHECK (confirmation_hours >= 1 AND confirmation_hours <= 168);

ALTER TABLE booking_requests
  DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE booking_requests
  ADD CONSTRAINT valid_status CHECK (
    status IN (
      'pending',
      'accepted',
      'declined',
      'expired',
      'cancelled',
      'accepted_cancelled'
    )
  );

COMMIT;
