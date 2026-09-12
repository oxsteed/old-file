-- Migration 427: database-level OxSteed Credit account integrity.
--
-- Customer reservations must remain covered by the wallet balance, and a
-- closed wallet must be fully settled. Keep these invariants below the API.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_account_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_type = 'customer_wallet'
     AND NEW.reserved_cents > NEW.balance_cents THEN
    RAISE EXCEPTION 'OxSteed Credit reservations cannot exceed a customer wallet balance'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.account_type = 'customer_wallet'
     AND NEW.status = 'closed'
     AND (NEW.balance_cents <> 0 OR NEW.reserved_cents <> 0) THEN
    RAISE EXCEPTION 'A non-zero OxSteed Credit wallet cannot be closed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_account_integrity_guard ON oxsteed_credit_accounts;

CREATE TRIGGER oxsteed_credit_account_integrity_guard
  BEFORE INSERT OR UPDATE OF account_type, customer_id, partner_id, currency_code,
    balance_cents, reserved_cents, status
  ON oxsteed_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_account_integrity();
