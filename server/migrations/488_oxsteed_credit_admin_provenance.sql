-- Migration 488: require administrator provenance for Credit control records.
--
-- These records define where customer value may be spent and how partners are
-- paid. The API already supplies an administrator, but the database must reject
-- direct inserts that would create an unattributed control-plane record.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_admin_creator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_by IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM users
        WHERE id = NEW.created_by
          AND is_active = TRUE
          AND role IN ('admin', 'super_admin')
     ) THEN
    RAISE EXCEPTION 'OxSteed Credit control records require an active administrator creator'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_partner_creator_guard ON oxsteed_credit_partners;
CREATE TRIGGER oxsteed_credit_partner_creator_guard
  BEFORE INSERT OR UPDATE OF created_by
  ON oxsteed_credit_partners
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_admin_creator();

DROP TRIGGER IF EXISTS oxsteed_credit_agreement_creator_guard ON oxsteed_credit_partner_agreements;
CREATE TRIGGER oxsteed_credit_agreement_creator_guard
  BEFORE INSERT OR UPDATE OF created_by
  ON oxsteed_credit_partner_agreements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_admin_creator();

DROP TRIGGER IF EXISTS oxsteed_credit_entitlement_creator_guard ON oxsteed_credit_customer_entitlements;
CREATE TRIGGER oxsteed_credit_entitlement_creator_guard
  BEFORE INSERT OR UPDATE OF created_by
  ON oxsteed_credit_customer_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_admin_creator();

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_creator_guard ON oxsteed_credit_settlements;
CREATE TRIGGER oxsteed_credit_settlement_creator_guard
  BEFORE INSERT OR UPDATE OF created_by
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_admin_creator();
