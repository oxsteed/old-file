-- Migration 496: keep customer access state aligned with agreement lifecycle.
--
-- An agreement suspension, expiry, or termination must not leave customer
-- entitlements looking spend-capable in administrative views. Reactivation of
-- the agreement does not reactivate access automatically; an administrator
-- must explicitly restore each entitlement.

CREATE OR REPLACE FUNCTION propagate_oxsteed_credit_agreement_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_entitlement_status VARCHAR(20);
  entitlement RECORD;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  target_entitlement_status := CASE NEW.status
    WHEN 'suspended' THEN 'suspended'
    WHEN 'expired' THEN 'expired'
    WHEN 'terminated' THEN 'revoked'
    ELSE NULL
  END;

  IF target_entitlement_status IS NULL THEN
    RETURN NEW;
  END IF;

  FOR entitlement IN
    SELECT id, customer_id, status
      FROM oxsteed_credit_customer_entitlements
     WHERE agreement_id = NEW.id
       AND status = 'active'
     FOR UPDATE
  LOOP
    UPDATE oxsteed_credit_customer_entitlements
       SET status = target_entitlement_status,
           reason = CASE target_entitlement_status
             WHEN 'suspended' THEN 'Credit access suspended because its agreement was suspended'
             WHEN 'expired' THEN 'Credit access expired because its agreement ended'
             ELSE 'Credit access revoked because its agreement was terminated'
           END,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'systemStatusPropagation', true,
             'agreementStatus', NEW.status
           ),
           updated_at = NOW()
     WHERE id = entitlement.id
       AND status = 'active';

    INSERT INTO oxsteed_credit_audit_events
      (action_type, actor_user_id, customer_id, partner_id, resource_type,
       resource_id, reason, before_state, after_state, metadata)
    VALUES (
      'credit.entitlement.agreement_status_propagated',
      NULL,
      entitlement.customer_id,
      NEW.partner_id,
      'credit_entitlement',
      entitlement.id::TEXT,
      'Customer Credit access was updated because its agreement changed status',
      jsonb_build_object('status', entitlement.status),
      jsonb_build_object('status', target_entitlement_status),
      jsonb_build_object('source', 'database_agreement_status_guard', 'agreementStatus', NEW.status)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_agreement_entitlement_status_guard
  ON oxsteed_credit_partner_agreements;

CREATE TRIGGER oxsteed_credit_agreement_entitlement_status_guard
  AFTER UPDATE OF status
  ON oxsteed_credit_partner_agreements
  FOR EACH ROW
  EXECUTE FUNCTION propagate_oxsteed_credit_agreement_status();

DO $$
DECLARE
  entitlement RECORD;
  target_entitlement_status VARCHAR(20);
BEGIN
  -- Normalize legacy rows created before agreement lifecycle propagation.
  FOR entitlement IN
    SELECT e.id, e.customer_id, p.id AS partner_id, e.status, a.status AS agreement_status
      FROM oxsteed_credit_customer_entitlements e
      JOIN oxsteed_credit_partner_agreements a ON a.id = e.agreement_id
      JOIN oxsteed_credit_partners p ON p.id = a.partner_id
     WHERE e.status = 'active'
       AND a.status IN ('suspended', 'expired', 'terminated')
     FOR UPDATE
  LOOP
    target_entitlement_status := CASE entitlement.agreement_status
      WHEN 'suspended' THEN 'suspended'
      WHEN 'expired' THEN 'expired'
      ELSE 'revoked'
    END;

    UPDATE oxsteed_credit_customer_entitlements
       SET status = target_entitlement_status,
           reason = CASE target_entitlement_status
             WHEN 'suspended' THEN 'Credit access suspended because its agreement was suspended'
             WHEN 'expired' THEN 'Credit access expired because its agreement ended'
             ELSE 'Credit access revoked because its agreement was terminated'
           END,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'systemStatusPropagation', true,
             'agreementStatus', entitlement.agreement_status,
             'migration', '496'
           ),
           updated_at = NOW()
     WHERE id = entitlement.id
       AND status = 'active';

    INSERT INTO oxsteed_credit_audit_events
      (action_type, actor_user_id, customer_id, partner_id, resource_type,
       resource_id, reason, before_state, after_state, metadata)
    VALUES (
      'credit.entitlement.agreement_status_propagated',
      NULL,
      entitlement.customer_id,
      entitlement.partner_id,
      'credit_entitlement',
      entitlement.id::TEXT,
      'Legacy customer Credit access was normalized to its agreement status',
      jsonb_build_object('status', entitlement.status),
      jsonb_build_object('status', target_entitlement_status),
      jsonb_build_object('source', 'migration_496_agreement_entitlement_status', 'agreementStatus', entitlement.agreement_status)
    );
  END LOOP;
END;
$$;
