-- Migration 464: keep posted reservation totals equal to active holds.
--
-- Account balances and holds are updated in the same transaction. A deferred
-- constraint trigger checks the final state at commit, so direct SQL paths
-- cannot create a wallet whose reserved total differs from its active holds.

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
    INTO expected_reserved
    FROM oxsteed_credit_holds h
   WHERE h.account_id = account_id_to_check
     AND h.status = 'active';

  IF recorded_reserved::NUMERIC IS DISTINCT FROM expected_reserved THEN
    RAISE EXCEPTION 'OxSteed Credit reserved balance must equal active hold total'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

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
