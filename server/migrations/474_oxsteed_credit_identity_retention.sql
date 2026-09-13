-- Migration 474: keep customer identity stable for every Credit record.
--
-- A customer role cannot change after any Credit record exists. This keeps
-- entitlements and empty/pre-created wallets from becoming owned by a helper
-- or broker, and preserves a stable identity for financial history.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_credit_records BOOLEAN;
BEGIN
  IF OLD.role = 'customer' AND NEW.role IS DISTINCT FROM OLD.role AND NEW.role <> 'customer' THEN
    SELECT EXISTS (
      SELECT 1
        FROM oxsteed_credit_accounts a
       WHERE a.customer_id = OLD.id
         AND a.account_type = 'customer_wallet'
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_customer_entitlements e
       WHERE e.customer_id = OLD.id
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_holds h
       WHERE h.customer_id = OLD.id
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_disputes d
       WHERE d.customer_id = OLD.id
          OR d.opened_by = OLD.id
          OR d.resolved_by = OLD.id
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_entitlement_bulk_requests r
       WHERE r.customer_id = OLD.id
          OR r.created_by = OLD.id
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_entitlement_requests r
       WHERE r.customer_id = OLD.id
          OR r.created_by = OLD.id
    ) INTO has_credit_records;

    IF has_credit_records THEN
      RAISE EXCEPTION 'A user with OxSteed Credit records must remain a customer'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_user_role_guard ON users;

CREATE TRIGGER oxsteed_credit_user_role_guard
  BEFORE UPDATE OF role
  ON users
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_user_role_change();
