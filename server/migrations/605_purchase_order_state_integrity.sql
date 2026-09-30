-- Migration 605: database-level guardrails for the purchase order lifecycle.
-- purchase_orders.status follows a 17-state graph that today exists only in
-- code (PO_TRANSITIONS in server/services/logisticsStateMachine.js), so
-- direct SQL or a stale worker could resurrect a closed purchase order
-- (closed -> draft would risk duplicate supplier payment) or skip deposit
-- states. The logistics services remain authoritative for permissions and
-- workflow decisions; this trigger encodes the same graph at the database
-- level. Keep this map in sync with PO_TRANSITIONS.
--
-- purchase_orders.status uses the purchase_order_status enum; statuses are
-- compared as text. Unknown legacy values are allowed to move (fail-open on
-- unknown OLD). INSERTs are unaffected.

CREATE OR REPLACE FUNCTION enforce_purchase_order_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
  allowed TEXT[];
BEGIN
  IF old_status IS DISTINCT FROM new_status THEN
    allowed := CASE old_status
      WHEN 'draft'                THEN ARRAY['quoted', 'cancelled']
      WHEN 'quoted'               THEN ARRAY['approved', 'cancelled', 'draft']
      WHEN 'approved'            THEN ARRAY['awaiting_deposit', 'cancelled']
      WHEN 'awaiting_deposit'    THEN ARRAY['deposit_collected', 'cancelled']
      WHEN 'deposit_collected'   THEN ARRAY['placed_with_supplier', 'cancelled']
      WHEN 'placed_with_supplier' THEN ARRAY['in_production', 'cancelled']
      WHEN 'in_production'       THEN ARRAY['production_complete', 'cancelled']
      WHEN 'production_complete' THEN ARRAY['ready_for_pickup']
      WHEN 'ready_for_pickup'    THEN ARRAY['in_transit']
      WHEN 'in_transit'          THEN ARRAY['customs_review', 'warehoused']
      WHEN 'customs_review'      THEN ARRAY['cleared', 'in_transit']
      WHEN 'cleared'             THEN ARRAY['warehoused']
      WHEN 'warehoused'          THEN ARRAY['allocated']
      WHEN 'allocated'           THEN ARRAY['fulfilled']
      WHEN 'fulfilled'           THEN ARRAY['closed']
      WHEN 'closed'              THEN ARRAY[]::TEXT[]
      WHEN 'cancelled'           THEN ARRAY[]::TEXT[]
      ELSE NULL
    END;

    IF allowed IS NOT NULL AND NOT (new_status = ANY (allowed)) THEN
      RAISE EXCEPTION 'Invalid purchase order transition: % -> %', old_status, new_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_order_state_integrity_guard ON purchase_orders;
CREATE TRIGGER purchase_order_state_integrity_guard
  BEFORE UPDATE OF status
  ON purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_purchase_order_state_integrity();
