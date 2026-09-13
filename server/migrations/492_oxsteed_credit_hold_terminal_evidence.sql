-- Migration 492: retain actor and reason evidence for Credit hold closure.
--
-- A hold is an authorization record, not just a reservation counter. Keep the
-- actor and reason for capture/release on the hold itself so operators can
-- explain a terminal state without reconstructing it from audit events.

ALTER TABLE oxsteed_credit_holds
  ADD COLUMN IF NOT EXISTS capture_actor_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS captured_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capture_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS release_actor_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS terminal_evidence_legacy BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve older terminal rows without inventing a human explanation. New
-- terminal rows cannot use this marker; it only keeps historical records
-- queryable while their original evidence is unavailable.
UPDATE oxsteed_credit_holds h
   SET captured_by = t.actor_user_id,
       capture_actor_type = CASE WHEN t.actor_type IN ('admin', 'system') THEN t.actor_type ELSE 'legacy' END,
       capture_reason = COALESCE(NULLIF(BTRIM(t.reason), ''), NULLIF(BTRIM(t.description), ''), 'Legacy hold capture evidence unavailable'),
       terminal_evidence_legacy = (
         t.actor_type NOT IN ('admin', 'system')
         OR t.actor_user_id IS NULL
         OR NULLIF(BTRIM(t.reason), '') IS NULL
         OR t.reason = 'Legacy transaction: reason unavailable'
       )
  FROM oxsteed_credit_transactions t
 WHERE h.status = 'captured'
   AND h.captured_transaction_id = t.id;

UPDATE oxsteed_credit_holds
   SET release_actor_type = 'legacy',
       release_reason = 'Legacy hold release evidence unavailable',
       terminal_evidence_legacy = TRUE
 WHERE status IN ('released', 'expired');

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_hold_terminal_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.terminal_evidence_legacy THEN
    RAISE EXCEPTION 'New OxSteed Credit holds cannot use legacy terminal evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.terminal_evidence_legacy IS DISTINCT FROM OLD.terminal_evidence_legacy THEN
    RAISE EXCEPTION 'OxSteed Credit legacy evidence marker cannot change'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    IF NEW.capture_actor_type IS NOT NULL
       OR NEW.captured_by IS NOT NULL
       OR NEW.capture_reason IS NOT NULL
       OR NEW.captured_transaction_id IS NOT NULL
       OR NEW.capture_idempotency_key IS NOT NULL
       OR NEW.captured_at IS NOT NULL
       OR NEW.release_actor_type IS NOT NULL
       OR NEW.released_by IS NOT NULL
       OR NEW.release_reason IS NOT NULL
       OR NEW.released_at IS NOT NULL
       OR NEW.terminal_evidence_legacy THEN
      RAISE EXCEPTION 'An active OxSteed Credit hold cannot contain terminal evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status IN ('released', 'expired') THEN
    IF NEW.released_at IS NULL
       OR NEW.capture_actor_type IS NOT NULL
       OR NEW.captured_by IS NOT NULL
       OR NEW.capture_reason IS NOT NULL
       OR NEW.captured_transaction_id IS NOT NULL
       OR NEW.capture_idempotency_key IS NOT NULL
       OR NEW.captured_at IS NOT NULL THEN
      RAISE EXCEPTION 'A released or expired OxSteed Credit hold requires release evidence only'
        USING ERRCODE = '23514';
    END IF;

    IF NOT NEW.terminal_evidence_legacy THEN
      IF NEW.release_actor_type NOT IN ('customer', 'admin', 'system')
         OR NULLIF(BTRIM(NEW.release_reason), '') IS NULL
         OR (NEW.release_actor_type IN ('customer', 'admin') AND NEW.released_by IS NULL) THEN
        RAISE EXCEPTION 'A new released or expired OxSteed Credit hold requires actor and reason evidence'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.status = 'captured' THEN
    IF NEW.capture_actor_type IS NULL
       OR NEW.captured_transaction_id IS NULL
       OR NULLIF(BTRIM(NEW.capture_idempotency_key), '') IS NULL
       OR NEW.captured_at IS NULL
       OR NEW.release_actor_type IS NOT NULL
       OR NEW.released_by IS NOT NULL
       OR NEW.release_reason IS NOT NULL
       OR NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'A captured OxSteed Credit hold requires capture evidence only'
        USING ERRCODE = '23514';
    END IF;

    IF NOT NEW.terminal_evidence_legacy THEN
      IF NEW.capture_actor_type NOT IN ('admin', 'system')
         OR NULLIF(BTRIM(NEW.capture_reason), '') IS NULL
         OR (NEW.capture_actor_type = 'admin' AND NEW.captured_by IS NULL) THEN
        RAISE EXCEPTION 'A new captured OxSteed Credit hold requires actor and reason evidence'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('captured', 'released', 'expired')
     AND (
       NEW.capture_actor_type IS DISTINCT FROM OLD.capture_actor_type
       OR NEW.captured_by IS DISTINCT FROM OLD.captured_by
       OR NEW.capture_reason IS DISTINCT FROM OLD.capture_reason
       OR NEW.release_actor_type IS DISTINCT FROM OLD.release_actor_type
       OR NEW.released_by IS DISTINCT FROM OLD.released_by
       OR NEW.release_reason IS DISTINCT FROM OLD.release_reason
     ) THEN
    RAISE EXCEPTION 'OxSteed Credit hold terminal evidence is append-only'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_terminal_evidence_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_terminal_evidence_guard
  BEFORE INSERT OR UPDATE
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_hold_terminal_evidence();
