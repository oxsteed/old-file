-- G-6/G-7 (persona roadmap): recipient acceptance + status-link lifecycle.
--
-- Adds, on booking_requests:
--   recipient_token            separate invite token for the recipient
--                              (the existing status_token stays the
--                              site-contact status link; one token per role
--                              so a site contact can never accept on the
--                              recipient's behalf);
--   recipient_consent_status   pending | accepted | declined, with
--                              recipient_consented_at / _method;
--   status_token_expires_at    both links expire 7 days after creation
--                              (no product precedent for a token TTL exists:
--                              quote lookup codes are 15-minute one-time
--                              challenges, invoice public tokens never
--                              expire; 7 days recorded in
--                              persona-roadmap-decisions.md D-10);
--   status_token_revoked_at    booker revocation, booking-level: revokes
--                              both links at once.
-- Adds, on jobs, the recipient carry-over columns matching the site-contact
-- columns migration 20261119090600 already added there.
-- Existing status_token rows are given 7 days from migration so live links
-- keep working for one bounded window instead of expiring on deploy.
-- The deposit still settles against booking.customer_id (the booker); no
-- column here changes the payer.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS recipient_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS recipient_consent_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS recipient_consented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recipient_consent_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS status_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_token_revoked_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_requests_recipient_consent_status_check'
      AND conrelid = 'booking_requests'::regclass
  ) THEN
    ALTER TABLE booking_requests
      ADD CONSTRAINT booking_requests_recipient_consent_status_check
      CHECK (recipient_consent_status IN ('pending', 'accepted', 'declined'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_requests_recipient_consent_method_check'
      AND conrelid = 'booking_requests'::regclass
  ) THEN
    ALTER TABLE booking_requests
      ADD CONSTRAINT booking_requests_recipient_consent_method_check
      CHECK (recipient_consent_method IS NULL OR recipient_consent_method IN ('token', 'account'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_requests_recipient_token
  ON booking_requests (recipient_token) WHERE recipient_token IS NOT NULL;

UPDATE booking_requests
   SET status_token_expires_at = NOW() + INTERVAL '7 days'
 WHERE status_token IS NOT NULL
   AND status_token_expires_at IS NULL;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_jobs_recipient_user_id
  ON jobs (recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_site_contact_user_id
  ON jobs (site_contact_user_id) WHERE site_contact_user_id IS NOT NULL;
