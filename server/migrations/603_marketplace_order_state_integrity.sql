-- Migration 603: database-level guardrails for marketplace order money state.
-- marketplace_orders.status has a value CHECK but no transition guard, so a
-- stale worker or direct SQL could reopen a fulfilled order (completed ->
-- processing), erase payment evidence (paid -> pending), or resurrect a
-- cancelled/refunded order. The order controllers remain authoritative for
-- permissions and workflow decisions; this trigger blocks impossible
-- transitions.
--
-- Allowed graph (values from 129_marketplace_orders.sql):
--   pending    -> paid, cancelled
--   paid       -> processing, cancelled, refunded
--   processing -> completed, cancelled, refunded
--   completed  -> refunded
--   cancelled, refunded -> (terminal)
-- Unknown legacy values are allowed to move (fail-open on unknown OLD),
-- but known states may only follow the graph above. INSERTs are unaffected.

CREATE OR REPLACE FUNCTION enforce_marketplace_order_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
BEGIN
  IF old_status IS DISTINCT FROM new_status THEN
    IF old_status IN ('cancelled', 'refunded') THEN
      RAISE EXCEPTION 'Terminal marketplace order status % cannot change', old_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'completed' AND new_status <> 'refunded' THEN
      RAISE EXCEPTION 'Completed marketplace orders may only transition to refunded, not to %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'processing'
       AND new_status NOT IN ('completed', 'cancelled', 'refunded') THEN
      RAISE EXCEPTION 'Invalid marketplace order transition: processing -> %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'paid'
       AND new_status NOT IN ('processing', 'cancelled', 'refunded') THEN
      RAISE EXCEPTION 'Invalid marketplace order transition: paid -> %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'pending' AND new_status NOT IN ('paid', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid marketplace order transition: pending -> %', new_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_order_state_integrity_guard ON marketplace_orders;
CREATE TRIGGER marketplace_order_state_integrity_guard
  BEFORE UPDATE OF status
  ON marketplace_orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_marketplace_order_state_integrity();
