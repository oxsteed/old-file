-- Migration 482: make closed Credit wallets terminal.
--
-- A closed wallet is a historical financial identity. Reopening it would
-- silently reactivate an old balance instead of creating a fresh, reviewed
-- account, so only active <-> suspended transitions remain reversible.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_account_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A closed OxSteed Credit account cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_account_state_guard ON oxsteed_credit_accounts;

CREATE TRIGGER oxsteed_credit_account_state_guard
  BEFORE UPDATE OF status
  ON oxsteed_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_account_state();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_accounts
     WHERE status = 'closed'
       AND (balance_cents <> 0 OR reserved_cents <> 0)
  ) THEN
    RAISE EXCEPTION 'Existing closed OxSteed Credit accounts have non-zero balances';
  END IF;
END;
$$;
