-- Migration 504: fail closed when a Credit wallet is suspended or closed.
--
-- User activity and application checks are not enough for a stored-value
-- ledger. Direct SQL and future services must not be able to spend from a
-- wallet that an administrator has suspended, or create a live hold against
-- one. Refunds, administrative adjustments, and releases remain available so
-- operators can reconcile and unwind value safely.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_spend_account_state()
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
     WHERE a.id IN (NEW.debit_account_id, NEW.credit_account_id)
       AND a.account_type = 'customer_wallet'
       AND a.status IS DISTINCT FROM 'active'
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit spending requires active customer wallets'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_spend_account_state_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_spend_account_state_guard
  BEFORE INSERT OR UPDATE OF transaction_type, debit_account_id, credit_account_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_spend_account_state();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_hold_account_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NOT EXISTS (
       SELECT 1
         FROM oxsteed_credit_accounts a
        WHERE a.id = NEW.account_id
          AND a.account_type = 'customer_wallet'
          AND a.status = 'active'
     ) THEN
    RAISE EXCEPTION 'Active OxSteed Credit holds require an active customer wallet'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_account_state_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_account_state_guard
  BEFORE INSERT OR UPDATE OF account_id, status
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_hold_account_state();
