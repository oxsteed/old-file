-- Migration 602: database-level guardrails for the booking request lifecycle.
-- A cancelled/expired/declined request must never be resurrected into
-- accepted (that path leads to payment capture and double-booking), and
-- terminal states must stay terminal. The application lifecycle service
-- (services/bookingRequestLifecycle.js) remains authoritative for
-- permissions and workflow decisions; this trigger blocks impossible
-- transitions from direct SQL or stale workers.
--
-- Allowed graph (observed from bookingController.js and migrations
-- 176/179/537/538):
--   pending          -> accepted, declined, expired, cancelled, counter_proposed
--   counter_proposed -> accepted, declined, expired, cancelled, pending
--   expired          -> cancelled
--   accepted         -> accepted_cancelled
--   declined, cancelled, accepted_cancelled -> (terminal)
-- Unknown legacy values are allowed to move (fail-open on unknown OLD),
-- but known states may only follow the graph above. INSERTs are unaffected.

CREATE OR REPLACE FUNCTION enforce_booking_request_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
BEGIN
  IF old_status IS DISTINCT FROM new_status THEN
    IF old_status IN ('declined', 'cancelled', 'accepted_cancelled') THEN
      RAISE EXCEPTION 'Terminal booking request status % cannot change', old_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'accepted' AND new_status <> 'accepted_cancelled' THEN
      RAISE EXCEPTION 'Accepted booking requests may only transition to accepted_cancelled, not to %', new_status
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

DROP TRIGGER IF EXISTS booking_request_state_integrity_guard ON booking_requests;
CREATE TRIGGER booking_request_state_integrity_guard
  BEFORE UPDATE OF status
  ON booking_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_booking_request_state_integrity();
