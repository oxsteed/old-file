-- Migration 457: fail closed on inactive-customer Credit spend paths.
--
-- Application checks protect normal requests, but the database must also
-- reject new purchases, transfers, and holds for inactive customers when a
-- maintenance script or future service bypasses the application layer.
-- Administrative loads, refunds, clawbacks, and hold releases remain
-- possible so operators can unwind or reconcile a closed account safely.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_customer_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_type NOT IN ('purchase', 'transfer') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_accounts a
      JOIN users owner ON owner.id = a.customer_id
     WHERE a.id IN (NEW.debit_account_id, NEW.credit_account_id)
       AND a.account_type = 'customer_wallet'
       AND owner.role = 'customer'
       AND owner.is_active IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit spend requires active customer accounts'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_customer_activity_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_customer_activity_guard
  BEFORE INSERT OR UPDATE OF transaction_type, debit_account_id, credit_account_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_customer_activity();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_hold_customer_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM users
     WHERE id = NEW.customer_id
       AND role = 'customer'
       AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit holds require an active customer'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_customer_activity_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_customer_activity_guard
  BEFORE INSERT OR UPDATE OF account_id, customer_id
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_hold_customer_activity();
