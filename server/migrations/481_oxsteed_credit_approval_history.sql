-- Migration 481: preserve approval evidence after administrator turnover.
--
-- approved_by identifies who authorized an agreement. That identity is
-- historical evidence and must remain valid even when the administrator is
-- later deactivated or leaves the platform.

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
          AND role IN ('admin', 'super_admin')
     ) THEN
    RAISE EXCEPTION 'Active OxSteed Credit agreements require an admin approval record'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Recheck existing records under the historical-identity policy. This keeps
-- the migration fail-closed for missing or incorrectly privileged approvers.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_partner_agreements a
      LEFT JOIN users u ON u.id = a.approved_by
     WHERE a.status = 'active'
       AND (u.id IS NULL OR u.role NOT IN ('admin', 'super_admin'))
  ) THEN
    RAISE EXCEPTION 'Existing active OxSteed Credit agreements have invalid approval records';
  END IF;
END;
$$;
