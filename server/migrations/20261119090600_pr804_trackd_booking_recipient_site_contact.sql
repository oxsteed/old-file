-- PR #804 ecosystem gaps G-6 (book for another person) and G-7 (site contact).
-- Adds recipient / booker / site-contact columns to booking_requests and
-- carries the site contact onto jobs when a booking converts.
-- The deposit stays charged to the booker: bookingDepositService charges
-- booking.customer_id, which remains the booker (see bookingController).
-- booking_requests.customer_id stays ON DELETE CASCADE (migration 176);
-- that cascade is unchanged here and is flagged in the Track D report:
-- account deletion does NOT settle open deposits before the cascade.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS booked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS site_contact_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS site_contact_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS site_contact_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_token VARCHAR(64);

-- A recipient who is not the booker must be a different account.
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_recipient_not_booker
  CHECK (recipient_user_id IS NULL OR recipient_user_id <> customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_requests_status_token
  ON booking_requests (status_token) WHERE status_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_requests_recipient_user_id
  ON booking_requests (recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_requests_site_contact_user_id
  ON booking_requests (site_contact_user_id) WHERE site_contact_user_id IS NOT NULL;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS site_contact_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS site_contact_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS site_contact_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
