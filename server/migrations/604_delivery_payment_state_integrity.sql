-- Migration 604: database-level guardrails for delivery payment money state.
-- delivery_payments.status has a value CHECK but no transition guard, so a
-- stale worker or direct SQL could rewrite a captured payment
-- (paid -> pending/failed) or resurrect a refunded one. The payment
-- controllers remain authoritative for permissions and workflow decisions;
-- this trigger blocks impossible transitions.
--
-- Allowed graph (values from 571 delivery payments migration):
--   pending -> paid, failed, cancelled
--   failed  -> pending                      (retry path)
--   paid    -> refunded
--   refunded, cancelled -> (terminal)
-- Unknown legacy values are allowed to move (fail-open on unknown OLD),
-- but known states may only follow the graph above. INSERTs are unaffected.

CREATE OR REPLACE FUNCTION enforce_delivery_payment_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
BEGIN
  IF old_status IS DISTINCT FROM new_status THEN
    IF old_status IN ('refunded', 'cancelled') THEN
      RAISE EXCEPTION 'Terminal delivery payment status % cannot change', old_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'paid' AND new_status <> 'refunded' THEN
      RAISE EXCEPTION 'Paid delivery payments may only transition to refunded, not to %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'failed' AND new_status <> 'pending' THEN
      RAISE EXCEPTION 'Failed delivery payments may only be retried via pending, not %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'pending'
       AND new_status NOT IN ('paid', 'failed', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid delivery payment transition: pending -> %', new_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_payment_state_integrity_guard ON delivery_payments;
CREATE TRIGGER delivery_payment_state_integrity_guard
  BEFORE UPDATE OF status
  ON delivery_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_delivery_payment_state_integrity();
