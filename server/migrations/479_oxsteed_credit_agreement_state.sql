-- Migration 479: enforce Credit agreement state transitions in the database.
--
-- Partner suspension or termination must not leave spend-capable agreements
-- active. Reactivating a partner does not silently reactivate an agreement;
-- an operator must make that decision explicitly.

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
       OR (OLD.status = 'suspended' AND NEW.status IN ('active', 'terminated'))
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

DROP TRIGGER IF EXISTS oxsteed_credit_agreement_state_guard ON oxsteed_credit_partner_agreements;

CREATE TRIGGER oxsteed_credit_agreement_state_guard
  BEFORE INSERT OR UPDATE OF status, partner_id
  ON oxsteed_credit_partner_agreements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_agreement_state();

CREATE OR REPLACE FUNCTION propagate_oxsteed_credit_partner_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement RECORD;
  target_status VARCHAR(24);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'suspended' THEN
    target_status := 'suspended';
  ELSIF NEW.status = 'terminated' THEN
    target_status := 'terminated';
  ELSE
    RETURN NEW;
  END IF;

  FOR agreement IN
    SELECT id, status
      FROM oxsteed_credit_partner_agreements
     WHERE partner_id = NEW.id
       AND status <> 'terminated'
     FOR UPDATE
  LOOP
    IF target_status = 'suspended' AND agreement.status <> 'active' THEN
      CONTINUE;
    END IF;

    UPDATE oxsteed_credit_partner_agreements
       SET status = target_status,
           updated_at = NOW()
     WHERE id = agreement.id;

    INSERT INTO oxsteed_credit_audit_events
      (action_type, partner_id, resource_type, resource_id, reason,
       before_state, after_state, metadata)
    VALUES (
      'credit.agreement.partner_status_propagated',
      NEW.id,
      'credit_agreement',
      agreement.id::TEXT,
      CASE WHEN target_status = 'suspended'
        THEN 'Agreement suspended because its Credit partner was suspended'
        ELSE 'Agreement terminated because its Credit partner was terminated'
      END,
      jsonb_build_object('status', agreement.status),
      jsonb_build_object('status', target_status),
      jsonb_build_object('source', 'database_partner_status_guard')
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_partner_status_guard ON oxsteed_credit_partners;

CREATE TRIGGER oxsteed_credit_partner_status_guard
  AFTER UPDATE OF status
  ON oxsteed_credit_partners
  FOR EACH ROW
  EXECUTE FUNCTION propagate_oxsteed_credit_partner_status();

-- Reconcile active agreements that predate the propagation guard.
DO $$
DECLARE
  partner RECORD;
  agreement RECORD;
  target_status VARCHAR(24);
BEGIN
  FOR partner IN
    SELECT id, status
      FROM oxsteed_credit_partners
     WHERE status IN ('suspended', 'terminated')
  LOOP
    target_status := CASE WHEN partner.status = 'suspended' THEN 'suspended' ELSE 'terminated' END;
    FOR agreement IN
      SELECT id, status
        FROM oxsteed_credit_partner_agreements
       WHERE partner_id = partner.id
         AND status <> 'terminated'
       FOR UPDATE
    LOOP
      IF target_status = 'suspended' AND agreement.status <> 'active' THEN
        CONTINUE;
      END IF;

      UPDATE oxsteed_credit_partner_agreements
         SET status = target_status,
             updated_at = NOW()
       WHERE id = agreement.id;
    END LOOP;
  END LOOP;
END;
$$;
