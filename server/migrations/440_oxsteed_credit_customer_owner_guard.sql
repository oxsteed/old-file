-- Keep OxSteed Credit customer wallets tied to customer identities.
-- This protects direct database writes as well as application service paths.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_customer_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_type = 'customer_wallet'
     AND NOT EXISTS (
       SELECT 1
         FROM users
        WHERE id = NEW.customer_id
          AND role = 'customer'
     ) THEN
    RAISE EXCEPTION 'OxSteed Credit customer wallets require a customer user role'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_customer_owner_guard ON oxsteed_credit_accounts;

CREATE TRIGGER oxsteed_credit_customer_owner_guard
  BEFORE INSERT OR UPDATE OF account_type, customer_id
  ON oxsteed_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_customer_owner();
