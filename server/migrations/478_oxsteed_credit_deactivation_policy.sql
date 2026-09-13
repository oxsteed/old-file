-- Migration 478: close Credit access safely when a customer is deactivated.
--
-- Deactivation is not deletion. Preserve the customer ledger, but suspend
-- access and release reservations so an inactive identity cannot keep value
-- locked or remain eligible for spending.

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

DROP TRIGGER IF EXISTS oxsteed_credit_user_activity_guard ON users;

CREATE TRIGGER oxsteed_credit_user_activity_guard
  AFTER UPDATE OF is_active
  ON users
  FOR EACH ROW
  EXECUTE FUNCTION suspend_oxsteed_credit_customer_access_on_deactivation();

-- Reconcile any inactive-customer Credit access that predates this policy.
UPDATE oxsteed_credit_customer_entitlements e
   SET status = 'suspended',
       reason = LEFT(CONCAT_WS(' | ', NULLIF(BTRIM(e.reason), ''), 'customer_inactive'), 500),
       updated_at = NOW()
  FROM users u
 WHERE e.customer_id = u.id
   AND e.status = 'active'
   AND (u.role <> 'customer' OR u.is_active IS DISTINCT FROM TRUE);

UPDATE oxsteed_credit_holds h
   SET status = 'released',
       released_at = NOW(),
       updated_at = NOW()
  FROM users u
 WHERE h.customer_id = u.id
   AND h.status = 'active'
   AND (u.role <> 'customer' OR u.is_active IS DISTINCT FROM TRUE);

UPDATE oxsteed_credit_accounts a
   SET reserved_cents = (
     SELECT COALESCE(SUM(h.amount_cents), 0)::BIGINT
       FROM oxsteed_credit_holds h
      WHERE h.account_id = a.id
        AND h.status = 'active'
   ),
       updated_at = NOW()
  FROM users u
 WHERE a.account_type = 'customer_wallet'
   AND a.customer_id = u.id
   AND u.is_active IS DISTINCT FROM TRUE;
