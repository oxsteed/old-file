-- Migration 493: bind Credit dispute actors to the roles that may perform them.
--
-- Existing records are preserved with an explicit legacy marker when their
-- actor history cannot be verified. New disputes and new resolutions must
-- always carry a current customer or administrator identity.

ALTER TABLE oxsteed_credit_disputes
  ADD COLUMN IF NOT EXISTS actor_evidence_legacy BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE oxsteed_credit_disputes d
   SET actor_evidence_legacy = TRUE
 WHERE d.actor_evidence_legacy = FALSE
   AND (
     d.opened_by IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM users u
        WHERE u.id = d.opened_by
          AND u.role = 'customer'
     )
     OR (
       d.status IN ('resolved', 'rejected')
       AND (
         d.resolved_by IS NULL
         OR NOT EXISTS (
           SELECT 1
             FROM users u
            WHERE u.id = d.resolved_by
              AND u.role IN ('admin', 'super_admin')
         )
       )
     )
   );

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_dispute_actor_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  opened_by_valid BOOLEAN;
  resolved_by_valid BOOLEAN;
  actor_changed BOOLEAN := TG_OP = 'INSERT';
  status_changed BOOLEAN := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    actor_changed := NEW.resolved_by IS DISTINCT FROM OLD.resolved_by;
    status_changed := NEW.status IS DISTINCT FROM OLD.status;

    IF OLD.actor_evidence_legacy AND NOT NEW.actor_evidence_legacy THEN
      RAISE EXCEPTION 'Legacy Credit dispute actor evidence cannot be cleared'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.resolved_by IS NOT NULL AND NEW.resolved_by IS DISTINCT FROM OLD.resolved_by THEN
      RAISE EXCEPTION 'Resolved Credit dispute actor cannot change after assignment'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
      RAISE EXCEPTION 'Resolved Credit dispute timestamp cannot change after closure'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.opened_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM users u
       WHERE u.id = NEW.opened_by
         AND u.role = 'customer'
         AND u.is_active = TRUE
    ) INTO opened_by_valid;
  ELSE
    opened_by_valid := FALSE;
  END IF;

  IF NOT opened_by_valid AND (TG_OP = 'INSERT' OR NOT NEW.actor_evidence_legacy) THEN
    RAISE EXCEPTION 'New OxSteed Credit disputes require an active customer opener'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolved_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM users u
       WHERE u.id = NEW.resolved_by
         AND u.role IN ('admin', 'super_admin')
         AND u.is_active = TRUE
    ) INTO resolved_by_valid;
  ELSE
    resolved_by_valid := FALSE;
  END IF;

  IF NEW.resolved_by IS NOT NULL AND (actor_changed OR NOT NEW.actor_evidence_legacy) AND NOT resolved_by_valid THEN
    RAISE EXCEPTION 'New OxSteed Credit dispute resolutions require an active administrator'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('resolved', 'rejected')
     AND (status_changed OR TG_OP = 'INSERT')
     AND NOT resolved_by_valid THEN
    RAISE EXCEPTION 'Closing an OxSteed Credit dispute requires an active administrator identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_dispute_actor_evidence_guard ON oxsteed_credit_disputes;

CREATE TRIGGER oxsteed_credit_dispute_actor_evidence_guard
  BEFORE INSERT OR UPDATE OF opened_by, resolved_by, resolved_at, status, actor_evidence_legacy
  ON oxsteed_credit_disputes
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_dispute_actor_evidence();
