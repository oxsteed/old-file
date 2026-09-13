-- Re-check current customer ownership on wallet updates and ledger postings.
-- A user's role can change after a wallet was created, so creation-time guards
-- alone are not enough for long-lived financial records.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_customer_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_type = 'customer_wallet'
     AND NOT EXISTS (
       SELECT 1
         FROM users
        WHERE id = NEW.customer_id
          AND role = 'customer'
     ) THEN
    RAISE EXCEPTION 'OxSteed Credit customer wallets require a customer user role'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_customer_owner_guard ON oxsteed_credit_accounts;

CREATE TRIGGER oxsteed_credit_customer_owner_guard
  BEFORE INSERT OR UPDATE
  ON oxsteed_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_customer_owner();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_customer_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_accounts a
      LEFT JOIN users owner ON owner.id = a.customer_id
     WHERE a.id IN (NEW.debit_account_id, NEW.credit_account_id)
       AND a.account_type = 'customer_wallet'
       AND (owner.id IS NULL OR owner.role <> 'customer')
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit ledger movements require customer-owned wallets'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_customer_owner_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_customer_owner_guard
  BEFORE INSERT OR UPDATE OF debit_account_id, credit_account_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_customer_owner();
