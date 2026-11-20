-- Migration 20261120020000: booking requests gain a real 'completed' status.
--
-- D-53 (Group 3, item 105): migration 602 locked the booking state graph
-- from an observed subset and missed the delivered branch of
-- releaseStaleAcceptedBookings, which moves an accepted booking to
-- 'completed' once its linked appointment is completed, and the public
-- status page, which shows the helper door name and care instructions
-- only once the booking is 'completed'. The valid_status CHECK did not
-- list 'completed' either, so the sweeper's delivered UPDATE threw on
-- every run; its catch swallowed the error and returned 0, which also
-- aborted the stale-release branch, so genuinely stale bookings were
-- never released while any delivered booking existed.
--
-- This migration aligns the guard with the code's intent: accepted may
-- move to 'completed' (delivered work) as well as to 'accepted_cancelled',
-- and 'completed' is terminal. 'completed' is deliberately NOT added to
-- the deposit service's TERMINAL_STATUSES: a completed booking's payment
-- is earned, never refunded. The accepted_cancelled-after-delivery
-- carve-out (service_delivered) stays for the manual cancel path.

ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE booking_requests
  ADD CONSTRAINT valid_status CHECK (status IN (
    'pending', 'accepted', 'declined', 'expired', 'cancelled',
    'accepted_cancelled', 'counter_proposed', 'completed'
  )) NOT VALID;
ALTER TABLE booking_requests VALIDATE CONSTRAINT valid_status;

CREATE OR REPLACE FUNCTION enforce_booking_request_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
BEGIN
  IF old_status IS DISTINCT FROM new_status THEN
    IF old_status IN ('declined', 'cancelled', 'accepted_cancelled', 'completed') THEN
      RAISE EXCEPTION 'Terminal booking request status % cannot change', old_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'accepted' AND new_status NOT IN ('accepted_cancelled', 'completed') THEN
      RAISE EXCEPTION 'Accepted booking requests may only transition to accepted_cancelled or completed, not to %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'expired' AND new_status <> 'cancelled' THEN
      RAISE EXCEPTION 'Expired booking requests may only transition to cancelled, not to %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'counter_proposed'
       AND new_status NOT IN ('accepted', 'declined', 'expired', 'cancelled', 'pending') THEN
      RAISE EXCEPTION 'Invalid booking request transition: counter_proposed -> %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'pending'
       AND new_status NOT IN ('accepted', 'declined', 'expired', 'cancelled', 'counter_proposed') THEN
      RAISE EXCEPTION 'Invalid booking request transition: pending -> %', new_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged (same function name); the replacement
-- above is the whole change. Kept explicit so a fresh schema and a
-- migrated schema agree.
DROP TRIGGER IF EXISTS booking_request_state_integrity_guard ON booking_requests;
CREATE TRIGGER booking_request_state_integrity_guard
  BEFORE UPDATE OF status
  ON booking_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_booking_request_state_integrity();
