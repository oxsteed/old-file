-- Migration 486: bind settlement approval evidence to an administrator.
--
-- A non-null approved_by value is not enough for a financial payout. The
-- referenced identity must be an administrator, while later deactivation is
-- allowed because the approval record is historical evidence.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('approved', 'paid')
     AND NOT EXISTS (
       SELECT 1
         FROM users
        WHERE id = NEW.approved_by
          AND role IN ('admin', 'super_admin')
     ) THEN
    RAISE EXCEPTION 'Approved OxSteed Credit settlements require an admin approval record'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_approval_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_approval_guard
  BEFORE INSERT OR UPDATE OF status, approved_by
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_approval();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_settlements s
      LEFT JOIN users u ON u.id = s.approved_by
     WHERE s.status IN ('approved', 'paid')
       AND (u.id IS NULL OR u.role NOT IN ('admin', 'super_admin'))
  ) THEN
    RAISE EXCEPTION 'Existing approved OxSteed Credit settlements have invalid approval records';
  END IF;
END;
$$;
