-- Migration 750: include marketplace reservations in reserved balance guards.
--
-- Migration 464 predates oxsteed_credit_reservations and only reconciled
-- customer wallets against media/partner holds. Marketplace reservations use
-- the same reserved_cents column, so the deferred guard must include both
-- sources and run after reservation rows change as well.

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

  SELECT COALESCE((SELECT SUM(h.amount_cents)
                    FROM oxsteed_credit_holds h
                   WHERE h.account_id = account_id_to_check
                     AND h.status = 'active'), 0)
       + COALESCE((SELECT SUM(r.amount_cents)
                    FROM oxsteed_credit_reservations r
                   WHERE r.account_id = account_id_to_check
                     AND r.status = 'active'), 0)
    INTO expected_reserved;

  IF recorded_reserved::NUMERIC IS DISTINCT FROM expected_reserved THEN
    RAISE EXCEPTION 'OxSteed Credit reserved balance must equal active hold and reservation total'
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

DROP TRIGGER IF EXISTS oxsteed_credit_reservation_total_guard ON oxsteed_credit_reservations;
CREATE CONSTRAINT TRIGGER oxsteed_credit_reservation_total_guard
  AFTER INSERT OR UPDATE OR DELETE
  ON oxsteed_credit_reservations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_reservation_total();
