-- Customer-specific partner entitlements must also belong to customer users.
-- Keep this invariant below the API so direct SQL cannot widen eligibility.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_entitlement_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM users
     WHERE id = NEW.customer_id
       AND role = 'customer'
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit entitlements require a customer user role'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_entitlement_owner_guard ON oxsteed_credit_customer_entitlements;

CREATE TRIGGER oxsteed_credit_entitlement_owner_guard
  BEFORE INSERT OR UPDATE OF customer_id
  ON oxsteed_credit_customer_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_entitlement_owner();
