-- Migration 451: protect Credit wallet ownership when a user's platform role
-- changes. A customer with financial history must remain a customer until the
-- wallet is settled and its history is preserved under the customer identity.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_credit_history BOOLEAN;
BEGIN
  IF OLD.role = 'customer' AND NEW.role IS DISTINCT FROM OLD.role AND NEW.role <> 'customer' THEN
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
      RAISE EXCEPTION 'A user with OxSteed Credit history must remain a customer'
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
