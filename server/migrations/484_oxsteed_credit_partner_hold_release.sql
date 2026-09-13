-- Migration 484: release holds when a Credit partner is suspended or terminated.
--
-- Partner shutdown makes an outstanding authorization impossible to fulfill.
-- Release those reservations immediately instead of leaving customer value
-- locked until the normal hold-expiry worker runs.

CREATE OR REPLACE FUNCTION propagate_oxsteed_credit_partner_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement RECORD;
  hold RECORD;
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
      CASE WHEN target_status = 'suspended'
        THEN 'Hold released because its Credit partner was suspended'
        ELSE 'Hold released because its Credit partner was terminated'
      END,
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

DO $$
DECLARE
  hold RECORD;
BEGIN
  -- Repair legacy reservations during the migration instead of blocking the
  -- rollout. The audit rows preserve why each customer reservation changed.
  FOR hold IN
    SELECT h.id, h.account_id, h.customer_id, h.partner_id, h.amount_cents,
           p.status AS partner_status
      FROM oxsteed_credit_holds h
      JOIN oxsteed_credit_partners p ON p.id = h.partner_id
     WHERE h.status = 'active'
       AND p.status IN ('suspended', 'terminated')
     FOR UPDATE
  LOOP
    UPDATE oxsteed_credit_holds
       SET status = 'released',
           released_at = NOW(),
           updated_at = NOW()
     WHERE id = hold.id;

    INSERT INTO oxsteed_credit_audit_events
      (action_type, customer_id, partner_id, resource_type, resource_id,
       reason, after_state, metadata)
    VALUES (
      'credit.hold.partner_status_released',
      hold.customer_id,
      hold.partner_id,
      'credit_hold',
      hold.id::TEXT,
      CASE WHEN hold.partner_status = 'suspended'
        THEN 'Legacy hold released because its Credit partner was suspended'
        ELSE 'Legacy hold released because its Credit partner was terminated'
      END,
      jsonb_build_object('status', 'released', 'amountCents', hold.amount_cents),
      jsonb_build_object('source', 'migration_484_partner_hold_release')
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
          AND h.partner_id IN (
            SELECT id FROM oxsteed_credit_partners
             WHERE status IN ('suspended', 'terminated')
          )
     );
END;
$$;
