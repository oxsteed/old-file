-- Migration 503: keep automatic Credit hold releases compatible with
-- terminal actor evidence.
--
-- Older lifecycle triggers released holds without recording the system actor
-- and reason required by the newer terminal-evidence guard. Replace those
-- functions so customer deactivation and partner shutdown remain fail-safe.

CREATE OR REPLACE FUNCTION suspend_oxsteed_credit_customer_access_on_deactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'customer' AND OLD.is_active IS TRUE AND NEW.is_active IS DISTINCT FROM TRUE THEN
    UPDATE oxsteed_credit_customer_entitlements
       SET status = 'suspended',
           reason = LEFT(CONCAT_WS(' | ', NULLIF(BTRIM(reason), ''), 'customer_inactive'), 500),
           updated_at = NOW()
     WHERE customer_id = NEW.id
       AND status = 'active';

    UPDATE oxsteed_credit_holds
       SET status = 'released',
           released_at = NOW(),
           release_actor_type = 'system',
           release_reason = 'Credit access suspended because customer was deactivated',
           updated_at = NOW()
     WHERE customer_id = NEW.id
       AND status = 'active';

    UPDATE oxsteed_credit_accounts a
       SET reserved_cents = (
         SELECT COALESCE(SUM(h.amount_cents), 0)::BIGINT
           FROM oxsteed_credit_holds h
          WHERE h.account_id = a.id
            AND h.status = 'active'
       ),
           updated_at = NOW()
     WHERE a.account_type = 'customer_wallet'
       AND a.customer_id = NEW.id;

    INSERT INTO oxsteed_credit_audit_events
      (action_type, customer_id, resource_type, resource_id, reason,
       before_state, after_state, metadata)
    VALUES (
      'credit.customer.deactivated',
      NEW.id,
      'credit_customer',
      NEW.id::TEXT,
      'Credit access suspended because the customer was deactivated',
      '{"active": true}'::JSONB,
      '{"active": false, "creditAccess": "suspended"}'::JSONB,
      '{"source": "database_deactivation_guard"}'::JSONB
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION propagate_oxsteed_credit_partner_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement RECORD;
  hold RECORD;
  target_status VARCHAR(24);
  automatic_release_reason TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'suspended' THEN
    target_status := 'suspended';
    automatic_release_reason := 'Hold released because its Credit partner was suspended';
  ELSIF NEW.status = 'terminated' THEN
    target_status := 'terminated';
    automatic_release_reason := 'Hold released because its Credit partner was terminated';
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

  FOR hold IN
    SELECT id, account_id, customer_id, amount_cents
      FROM oxsteed_credit_holds
     WHERE partner_id = NEW.id
       AND status = 'active'
     FOR UPDATE
  LOOP
    UPDATE oxsteed_credit_holds
       SET status = 'released',
           released_at = NOW(),
           release_actor_type = 'system',
           release_reason = automatic_release_reason,
           updated_at = NOW()
     WHERE id = hold.id
       AND status = 'active';

    INSERT INTO oxsteed_credit_audit_events
      (action_type, actor_user_id, customer_id, partner_id, resource_type,
       resource_id, reason, after_state, metadata)
    VALUES (
      'credit.hold.partner_status_released',
      NULL,
      hold.customer_id,
      NEW.id,
      'credit_hold',
      hold.id::TEXT,
      automatic_release_reason,
      jsonb_build_object('status', 'released', 'amountCents', hold.amount_cents),
      jsonb_build_object('source', 'database_partner_status_guard')
    );
  END LOOP;

  UPDATE oxsteed_credit_accounts a
     SET reserved_cents = (
       SELECT COALESCE(SUM(h.amount_cents), 0)::BIGINT
         FROM oxsteed_credit_holds h
        WHERE h.account_id = a.id
          AND h.status = 'active'
     ),
         updated_at = NOW()
   WHERE a.account_type = 'customer_wallet'
     AND EXISTS (
       SELECT 1
         FROM oxsteed_credit_holds h
        WHERE h.account_id = a.id
          AND h.partner_id = NEW.id
     );

  RETURN NEW;
END;
$$;
