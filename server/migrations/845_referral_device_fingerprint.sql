BEGIN;

-- 845: P2-6-F12 referral anti-farming: device fingerprint capture.
--
-- The referral program already pays only on the first-completed-job value
-- event, with per-referrer velocity caps and a shared-signup-IP guard. The
-- v7 re-audit left this PARTIAL: caps are per-referrer only (a ring using
-- many referrer codes is uncapped) and there was no device-level signal.
--
-- The client persists a random device id in localStorage and sends it as
-- X-Device-Fingerprint on registration; the server stores it on
-- pending_registrations at terms acceptance and copies it to users at
-- account creation. grantReferralReward withholds the reward when too many
-- of one referrer's referees share a device in a trailing week, and when
-- too many rewarded referees share a signup IP across referrers.
--
-- NULL/missing fingerprints fail open (same rationale as the IP check):
-- the first-job value event remains the primary guard.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_device_fingerprint VARCHAR(128);

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS signup_device_fingerprint VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_users_signup_device_fingerprint
  ON users(signup_device_fingerprint)
  WHERE signup_device_fingerprint IS NOT NULL;

COMMIT;
