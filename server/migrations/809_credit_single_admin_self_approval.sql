-- Migration 809: single-super-admin maker-checker break-glass flag (off by
-- default) + a terminal 'completed' status for booking_requests.
--
-- P1-9-F05: every OxSteed Credit pending action needs a distinct checker, so
-- an org with a single super admin can never complete one. The
-- credit_single_admin_self_approval flag (default FALSE, fails closed) lets a
-- lone super admin self-approve: the service additionally requires fewer
-- than 2 active super admins, a fresh step-up challenge, and writes an
-- auditable self-approved decision. With the flag off (default) behavior is
-- unchanged: self-approval is a hard 403.
--
-- P3-8-F11: releaseStaleAcceptedBookings flipped accepted -> accepted_cancelled
-- after the scheduled end even when the service was delivered. Delivered
-- bookings now move to 'completed' instead of being cancelled.

BEGIN;

INSERT INTO feature_flags (key, is_enabled, description)
VALUES (
  'credit_single_admin_self_approval',
  FALSE,
  'Break-glass: allow the single super admin to self-approve OxSteed Credit pending actions (fresh step-up + audit required; only applies when fewer than 2 active super admins exist)'
)
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_status'
      AND pg_get_constraintdef(oid) LIKE '%completed%'
  ) THEN
    ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS valid_status;
    ALTER TABLE booking_requests
      ADD CONSTRAINT valid_status CHECK (
        status IN (
          'pending', 'accepted', 'declined', 'expired', 'cancelled',
          'accepted_cancelled', 'counter_proposed', 'completed'
        )
      );
  END IF;
END $$;

COMMIT;
