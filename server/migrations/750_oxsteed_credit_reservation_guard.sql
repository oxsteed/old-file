-- Migration 750: extend the reserved-balance guard to non-hold reservations.
--
-- Migration 464 asserted reserved_cents = SUM(active holds) at commit time.
-- Migration 640 later introduced oxsteed_credit_reservations (non-hold
-- reservations for withdrawals and settlement payouts) and the application
-- treats reserved_cents = SUM(active holds) + SUM(active reservations).
-- Marketplace code that creates a reservation and increments reserved_cents
-- in the same transaction was failing the stale 464 invariant at commit.
--
-- This migration replaces the guard function so the expected total is
-- holds + active reservations per account, recreates the existing
-- constraint triggers against the updated function, and attaches the same
-- deferred guard to oxsteed_credit_reservations so direct SQL on that
-- table is checked too. Only customer_wallet accounts are checked, exactly
-- as in migration 464. Migration 464 itself is not modified.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_reservation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_id_to_check BIGINT;
  recorded_reserved BIGINT;
  expected_reserved NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'oxsteed_credit_accounts' THEN
    account_id_to_check := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    account_id_to_check := CASE WHEN TG_OP = 'DELETE' THEN OLD.account_id ELSE NEW.account_id END;
  END IF;

  SELECT a.reserved_cents
    INTO recorded_reserved
    FROM oxsteed_credit_accounts a
   WHERE a.id = account_id_to_check
     AND a.account_type = 'customer_wallet';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(h.amount_cents), 0)
       + COALESCE((SELECT SUM(r.amount_cents)
                     FROM oxsteed_credit_reservations r
                    WHERE r.account_id = account_id_to_check
                      AND r.status = 'active'), 0)
    INTO expected_reserved
    FROM oxsteed_credit_holds h
   WHERE h.account_id = account_id_to_check
     AND h.status = 'active';

  IF recorded_reserved::NUMERIC IS DISTINCT FROM expected_reserved THEN
    RAISE EXCEPTION 'OxSteed Credit reserved balance must equal active hold plus active reservation total'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

-- Recreate the existing guards against the updated function (idempotent).

DROP TRIGGER IF EXISTS oxsteed_credit_account_reservation_guard ON oxsteed_credit_accounts;

CREATE CONSTRAINT TRIGGER oxsteed_credit_account_reservation_guard
  AFTER INSERT OR UPDATE OR DELETE
  ON oxsteed_credit_accounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_reservation_total();

DROP TRIGGER IF EXISTS oxsteed_credit_hold_reservation_guard ON oxsteed_credit_holds;

CREATE CONSTRAINT TRIGGER oxsteed_credit_hold_reservation_guard
  AFTER INSERT OR UPDATE OR DELETE
  ON oxsteed_credit_holds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_reservation_total();

-- Attach the same deferred guard to the reservations table.

DROP TRIGGER IF EXISTS oxsteed_credit_reservation_reservation_guard ON oxsteed_credit_reservations;

CREATE CONSTRAINT TRIGGER oxsteed_credit_reservation_reservation_guard
  AFTER INSERT OR UPDATE OR DELETE
  ON oxsteed_credit_reservations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_reservation_total();
