-- Migration 558: allow account-mode changes for empty Credit setup wallets.
--
-- A customer wallet is often created before the user ever uses OxSteed
-- Credit. The empty wallet is not financial history and should not make the
-- account type permanent. Once there is a balance, ledger activity, hold,
-- entitlement, dispute, or Credit request, keep the customer identity locked.

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
       WHERE a.customer_id = OLD.id
         AND a.account_type = 'customer_wallet'
         AND (
           a.balance_cents <> 0
           OR a.reserved_cents <> 0
           OR a.last_entry_hash IS NOT NULL
           OR a.last_posted_at IS NOT NULL
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
              WHERE h.account_id = a.id OR h.customer_id = OLD.id
           )
         )
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_customer_entitlements e
       WHERE e.customer_id = OLD.id
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_disputes d
       WHERE d.customer_id = OLD.id
          OR d.opened_by = OLD.id
          OR d.resolved_by = OLD.id
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_entitlement_bulk_requests r
       WHERE r.customer_id = OLD.id
          OR r.created_by = OLD.id
      UNION ALL
      SELECT 1
        FROM oxsteed_credit_entitlement_requests r
       WHERE r.customer_id = OLD.id
          OR r.created_by = OLD.id
    ) INTO has_credit_history;

    IF has_credit_history THEN
      RAISE EXCEPTION 'A user with OxSteed Credit activity must remain a customer'
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
