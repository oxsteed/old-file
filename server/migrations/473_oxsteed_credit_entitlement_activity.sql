-- Active customer access must belong to an active customer, even when a
-- maintenance script writes directly to the entitlement table.
CREATE OR REPLACE FUNCTION validate_oxsteed_credit_entitlement_customer_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NOT EXISTS (
       SELECT 1
         FROM users
        WHERE id = NEW.customer_id
          AND role = 'customer'
          AND is_active = TRUE
     ) THEN
    RAISE EXCEPTION 'Active OxSteed Credit entitlements require an active customer'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_entitlement_customer_activity_guard
  ON oxsteed_credit_customer_entitlements;
CREATE TRIGGER oxsteed_credit_entitlement_customer_activity_guard
BEFORE INSERT OR UPDATE OF customer_id, status ON oxsteed_credit_customer_entitlements
FOR EACH ROW
EXECUTE FUNCTION validate_oxsteed_credit_entitlement_customer_activity();

-- Credit access history must not disappear if a hard-delete path is ever
-- called outside the scheduled deletion worker.
ALTER TABLE oxsteed_credit_customer_entitlements
  DROP CONSTRAINT IF EXISTS oxsteed_credit_customer_entitlements_customer_id_fkey;

ALTER TABLE oxsteed_credit_customer_entitlements
  ADD CONSTRAINT oxsteed_credit_customer_entitlements_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT;
