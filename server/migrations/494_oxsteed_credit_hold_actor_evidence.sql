-- Migration 494: bind Credit hold actors to the owner and operator roles.
--
-- A hold controls spendable customer balance. Its creator, customer release,
-- and administrative capture actors must remain attributable below the API.
-- Older rows that cannot be reconstructed are retained with an explicit
-- legacy marker and are excluded from the new-record invariant.

ALTER TABLE oxsteed_credit_holds
  ADD COLUMN IF NOT EXISTS actor_evidence_legacy BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE oxsteed_credit_holds h
   SET actor_evidence_legacy = TRUE
 WHERE h.actor_evidence_legacy = FALSE
   AND (
     h.created_by IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM users u
        WHERE u.id = h.created_by
          AND u.id = h.customer_id
          AND u.role = 'customer'
     )
     OR (
       h.status = 'captured'
       AND (
         h.capture_actor_type IS NULL
         OR h.capture_actor_type NOT IN ('admin', 'system')
         OR (h.capture_actor_type = 'admin' AND (
           h.captured_by IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM users u
              WHERE u.id = h.captured_by
                AND u.role IN ('admin', 'super_admin')
           )
         ))
         OR (h.capture_actor_type = 'system' AND h.captured_by IS NOT NULL)
       )
     )
     OR (
       h.status IN ('released', 'expired')
       AND (
         h.release_actor_type IS NULL
         OR h.release_actor_type NOT IN ('customer', 'admin', 'system')
         OR (h.release_actor_type = 'customer' AND (
           h.released_by IS NULL
           OR h.released_by IS DISTINCT FROM h.customer_id
           OR NOT EXISTS (
             SELECT 1
               FROM users u
              WHERE u.id = h.released_by
                AND u.role = 'customer'
           )
         ))
         OR (h.release_actor_type = 'admin' AND (
           h.released_by IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM users u
              WHERE u.id = h.released_by
                AND u.role IN ('admin', 'super_admin')
           )
         ))
         OR (h.release_actor_type = 'system' AND h.released_by IS NOT NULL)
       )
     )
   );

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_hold_actor_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creator_valid BOOLEAN;
  capture_actor_valid BOOLEAN;
  release_actor_valid BOOLEAN;
  status_changed BOOLEAN := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'INSERT' AND NEW.actor_evidence_legacy THEN
    RAISE EXCEPTION 'New OxSteed Credit holds cannot use legacy actor evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    status_changed := NEW.status IS DISTINCT FROM OLD.status;
    IF OLD.actor_evidence_legacy AND NOT NEW.actor_evidence_legacy THEN
      RAISE EXCEPTION 'Legacy Credit hold actor evidence cannot be cleared'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM users u
     WHERE u.id = NEW.created_by
       AND u.id = NEW.customer_id
       AND u.role = 'customer'
       AND u.is_active = TRUE
  ) INTO creator_valid;

  IF TG_OP = 'INSERT' AND NOT creator_valid THEN
    RAISE EXCEPTION 'New OxSteed Credit holds require the active customer owner as creator'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'captured' AND (status_changed OR TG_OP = 'INSERT') THEN
    IF NEW.capture_actor_type = 'admin' THEN
      SELECT EXISTS (
        SELECT 1
          FROM users u
         WHERE u.id = NEW.captured_by
           AND u.role IN ('admin', 'super_admin')
           AND u.is_active = TRUE
      ) INTO capture_actor_valid;
    ELSIF NEW.capture_actor_type = 'system' THEN
      capture_actor_valid := NEW.captured_by IS NULL;
    ELSE
      capture_actor_valid := FALSE;
    END IF;

    IF NOT capture_actor_valid THEN
      RAISE EXCEPTION 'Credit hold capture requires an active administrator or system actor'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('released', 'expired') AND (status_changed OR TG_OP = 'INSERT') THEN
    IF NEW.release_actor_type = 'customer' THEN
      SELECT EXISTS (
        SELECT 1
          FROM users u
         WHERE u.id = NEW.released_by
           AND u.id = NEW.customer_id
           AND u.role = 'customer'
           AND u.is_active = TRUE
      ) INTO release_actor_valid;
    ELSIF NEW.release_actor_type = 'admin' THEN
      SELECT EXISTS (
        SELECT 1
          FROM users u
         WHERE u.id = NEW.released_by
           AND u.role IN ('admin', 'super_admin')
           AND u.is_active = TRUE
      ) INTO release_actor_valid;
    ELSIF NEW.release_actor_type = 'system' THEN
      release_actor_valid := NEW.released_by IS NULL;
    ELSE
      release_actor_valid := FALSE;
    END IF;

    IF NOT release_actor_valid THEN
      RAISE EXCEPTION 'Credit hold release requires the owner, an active administrator, or the system'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_actor_evidence_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_actor_evidence_guard
  BEFORE INSERT OR UPDATE OF created_by, customer_id, status, capture_actor_type,
    captured_by, release_actor_type, released_by, actor_evidence_legacy
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_hold_actor_evidence();
