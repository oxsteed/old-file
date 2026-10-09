-- Migration 751: allow verified Media creator wallets to use the shared
-- customer_wallet journal without weakening ordinary customer-only paths.
--
-- The creator settlement service has an explicit allowNonCustomerOwner path
-- for helpers, helper_pro accounts, and brokers. Migrations 440/442 still
-- rejected those recipients at the database trigger boundary, so the first
-- creator payout could never create its recipient wallet. Creator wallets
-- remain customer_wallet accounts for the shared append-only journal; the
-- application keeps ordinary customer operations restricted to customers.

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
          AND role IN ('customer', 'helper', 'helper_pro', 'broker')
     ) THEN
    RAISE EXCEPTION 'OxSteed Credit wallets require an eligible user role'
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
       AND (owner.id IS NULL OR owner.role NOT IN ('customer', 'helper', 'helper_pro', 'broker'))
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit ledger movements require eligible wallet owners'
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

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_credit_history BOOLEAN;
BEGIN
  IF OLD.role IN ('customer', 'helper', 'helper_pro', 'broker')
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role NOT IN ('customer', 'helper', 'helper_pro', 'broker') THEN
    SELECT EXISTS (
      SELECT 1
        FROM oxsteed_credit_accounts a
       WHERE a.account_type = 'customer_wallet'
         AND a.customer_id = OLD.id
         AND (
           a.balance_cents <> 0
           OR a.reserved_cents <> 0
           OR EXISTS (
             SELECT 1 FROM oxsteed_credit_transaction_entries e
              WHERE e.account_id = a.id
           )
           OR EXISTS (
             SELECT 1 FROM oxsteed_credit_transactions t
              WHERE t.debit_account_id = a.id OR t.credit_account_id = a.id
           )
           OR EXISTS (
             SELECT 1 FROM oxsteed_credit_holds h
              WHERE h.account_id = a.id
           )
         )
    ) INTO has_credit_history;

    IF has_credit_history THEN
      RAISE EXCEPTION 'A user with OxSteed Credit history must keep an eligible wallet role'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_user_role_guard ON users;

CREATE TRIGGER oxsteed_credit_user_role_guard
  BEFORE UPDATE OF role
  ON users
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_user_role_change();
