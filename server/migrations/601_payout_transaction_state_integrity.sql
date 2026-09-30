-- Migration 601: database-level guardrails for payout money movement.
-- payout_transactions.transaction_status has no value CHECK and no transition
-- guard, so a stale worker or direct SQL could resurrect a completed payout
-- (double payout) or mark a failed payout completed without provider
-- confirmation. The application remains authoritative for permissions and
-- workflow decisions; this trigger only blocks impossible transitions.
--
-- Allowed graph (mirrors the documented lifecycle in 137_payout_methods.sql):
--   initiated   -> processing, failed
--   processing  -> completed, failed
--   failed      -> initiated, processing      (retry path)
--   completed   -> refunded
--   refunded    -> (terminal)
-- Unknown legacy values are allowed to move (fail-open on unknown OLD),
-- but known states may only follow the graph above. INSERTs are unaffected.

CREATE OR REPLACE FUNCTION enforce_payout_transaction_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD.transaction_status::text;
  new_status TEXT := NEW.transaction_status::text;
BEGIN
  IF old_status IS DISTINCT FROM new_status THEN
    IF old_status = 'refunded' THEN
      RAISE EXCEPTION 'Refunded payout transactions are terminal and cannot change state'
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'completed' AND new_status <> 'refunded' THEN
      RAISE EXCEPTION 'Completed payout transactions may only transition to refunded, not to %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'failed' AND new_status NOT IN ('initiated', 'processing') THEN
      RAISE EXCEPTION 'Failed payout transactions may only be retried via initiated or processing, not %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'processing' AND new_status NOT IN ('completed', 'failed') THEN
      RAISE EXCEPTION 'Invalid payout transaction transition: processing -> %', new_status
        USING ERRCODE = '23514';
    END IF;

    IF old_status = 'initiated' AND new_status NOT IN ('processing', 'failed') THEN
      RAISE EXCEPTION 'Invalid payout transaction transition: initiated -> %', new_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payout_transaction_state_integrity_guard ON payout_transactions;
CREATE TRIGGER payout_transaction_state_integrity_guard
  BEFORE UPDATE OF transaction_status
  ON payout_transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payout_transaction_state_integrity();
