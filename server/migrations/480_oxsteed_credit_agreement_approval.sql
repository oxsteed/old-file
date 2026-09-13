-- Migration 480: require accountable approval for active agreements.
--
-- An active agreement enables customer spending. Its approval must therefore
-- identify an active platform administrator, even when SQL bypasses the API.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_agreement_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NOT EXISTS (
       SELECT 1
         FROM users
        WHERE id = NEW.approved_by
          AND is_active = TRUE
          AND role IN ('admin', 'super_admin')
     ) THEN
    RAISE EXCEPTION 'Active OxSteed Credit agreements require an active admin approver'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_agreement_approval_guard ON oxsteed_credit_partner_agreements;

CREATE TRIGGER oxsteed_credit_agreement_approval_guard
  BEFORE INSERT OR UPDATE OF status, approved_by
  ON oxsteed_credit_partner_agreements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_agreement_approval();

-- Fail the migration rather than silently preserving an active agreement with
-- missing approval evidence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_partner_agreements a
      LEFT JOIN users u ON u.id = a.approved_by
     WHERE a.status = 'active'
       AND (u.id IS NULL OR u.is_active IS DISTINCT FROM TRUE
         OR u.role NOT IN ('admin', 'super_admin'))
  ) THEN
    RAISE EXCEPTION 'Existing active OxSteed Credit agreements have invalid approval evidence';
  END IF;
END;
$$;
