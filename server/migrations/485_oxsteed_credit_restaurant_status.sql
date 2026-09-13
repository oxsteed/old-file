-- Migration 485: align Credit partner availability with restaurant status.
--
-- A restaurant is the actual fulfillment location. If it is no longer active,
-- its Credit partner must stop accepting new spend even when an operator
-- changes only the restaurant record. Reactivation remains an explicit Credit
-- partner decision.

CREATE OR REPLACE FUNCTION propagate_oxsteed_credit_restaurant_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  partner RECORD;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  FOR partner IN
    SELECT id, status
      FROM oxsteed_credit_partners
     WHERE restaurant_id = NEW.id
       AND status = 'active'
     FOR UPDATE
  LOOP
    UPDATE oxsteed_credit_partners
       SET status = 'suspended',
           updated_at = NOW()
     WHERE id = partner.id
       AND status = 'active';

    INSERT INTO oxsteed_credit_audit_events
      (action_type, partner_id, resource_type, resource_id, reason,
       before_state, after_state, metadata)
    VALUES (
      'credit.partner.restaurant_status_propagated',
      partner.id,
      'credit_partner',
      partner.id::TEXT,
      'Credit partner suspended because its restaurant is not active',
      jsonb_build_object('status', partner.status),
      jsonb_build_object('status', 'suspended', 'restaurantStatus', NEW.status),
      jsonb_build_object('source', 'database_restaurant_status_guard')
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_restaurant_status_guard ON food_restaurants;

CREATE TRIGGER oxsteed_credit_restaurant_status_guard
  AFTER UPDATE OF status
  ON food_restaurants
  FOR EACH ROW
  EXECUTE FUNCTION propagate_oxsteed_credit_restaurant_status();

DO $$
DECLARE
  partner RECORD;
BEGIN
  -- Repair pre-existing records without blocking deployment. Each partner
  -- update invokes the normal agreement and hold propagation trigger.
  FOR partner IN
    SELECT p.id, p.status, fr.status AS restaurant_status
      FROM oxsteed_credit_partners p
      JOIN food_restaurants fr ON fr.id = p.restaurant_id
     WHERE p.status = 'active'
       AND fr.status <> 'active'
     FOR UPDATE
  LOOP
    UPDATE oxsteed_credit_partners
       SET status = 'suspended',
           updated_at = NOW()
     WHERE id = partner.id
       AND status = 'active';

    INSERT INTO oxsteed_credit_audit_events
      (action_type, partner_id, resource_type, resource_id, reason,
       before_state, after_state, metadata)
    VALUES (
      'credit.partner.restaurant_status_propagated',
      partner.id,
      'credit_partner',
      partner.id::TEXT,
      'Legacy Credit partner suspended because its restaurant is not active',
      jsonb_build_object('status', partner.status),
      jsonb_build_object('status', 'suspended', 'restaurantStatus', partner.restaurant_status),
      jsonb_build_object('source', 'migration_485_restaurant_status')
    );
  END LOOP;
END;
$$;
