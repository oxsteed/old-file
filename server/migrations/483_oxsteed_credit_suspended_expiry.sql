-- Migration 483: allow suspended agreements to reach their contractual end.
--
-- A suspended agreement is not spend-capable, but it can still outlive its
-- end date. Let the expiry worker record that terminal business outcome
-- without permitting draft or approval-pending agreements to skip lifecycle
-- stages.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_agreement_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  partner_status VARCHAR(24);
  restaurant_status VARCHAR(24);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('pending_approval', 'terminated'))
       OR (OLD.status = 'pending_approval' AND NEW.status IN ('draft', 'active', 'terminated'))
       OR (OLD.status = 'active' AND NEW.status IN ('suspended', 'expired', 'terminated'))
       OR (OLD.status = 'suspended' AND NEW.status IN ('active', 'expired', 'terminated'))
       OR (OLD.status = 'expired' AND NEW.status = 'terminated')
     ) THEN
    RAISE EXCEPTION 'Invalid OxSteed Credit agreement status transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    SELECT p.status, fr.status
      INTO partner_status, restaurant_status
      FROM oxsteed_credit_partners p
      JOIN food_restaurants fr ON fr.id = p.restaurant_id
     WHERE p.id = NEW.partner_id;

    IF partner_status IS DISTINCT FROM 'active'
       OR restaurant_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Active OxSteed Credit agreements require an active partner and restaurant'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
