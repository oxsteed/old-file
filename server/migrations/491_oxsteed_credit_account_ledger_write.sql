-- Migration 491: protect materialized Credit account ledger state.
--
-- Account balances and hash heads are a read-optimized projection of the
-- append-only journal. Bind every projection update to the exact posted
-- transaction that created it so direct SQL cannot rewrite stored value.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_account_ledger_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ledger_transaction_id TEXT;
  ledger_transaction RECORD;
  expected_balance BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance_cents <> 0
       OR NEW.ledger_version <> 0
       OR NEW.last_entry_hash IS NOT NULL
       OR NEW.last_posted_at IS NOT NULL THEN
      RAISE EXCEPTION 'New OxSteed Credit accounts must start with an empty ledger'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.balance_cents IS NOT DISTINCT FROM OLD.balance_cents
     AND NEW.ledger_version IS NOT DISTINCT FROM OLD.ledger_version
     AND NEW.last_entry_hash IS NOT DISTINCT FROM OLD.last_entry_hash
     AND NEW.last_posted_at IS NOT DISTINCT FROM OLD.last_posted_at THEN
    RETURN NEW;
  END IF;

  ledger_transaction_id := NULLIF(BTRIM(current_setting('oxsteed.credit_ledger_transaction_id', TRUE)), '');
  IF ledger_transaction_id IS NULL THEN
    RAISE EXCEPTION 'OxSteed Credit account ledger state may only change through journal posting'
      USING ERRCODE = '23514';
  END IF;

  SELECT t.amount_cents, t.debit_account_id, t.credit_account_id,
         t.status, t.posted_at
    INTO ledger_transaction
    FROM oxsteed_credit_transactions t
   WHERE t.id::TEXT = ledger_transaction_id
   LIMIT 1;

  IF NOT FOUND
     OR ledger_transaction.status <> 'posted'
     OR ledger_transaction.posted_at IS NULL
     OR (ledger_transaction.debit_account_id <> NEW.id
         AND ledger_transaction.credit_account_id <> NEW.id) THEN
    RAISE EXCEPTION 'OxSteed Credit account update is not bound to a posted journal transaction'
      USING ERRCODE = '23514';
  END IF;

  expected_balance := OLD.balance_cents + CASE
    WHEN ledger_transaction.debit_account_id = NEW.id THEN -ledger_transaction.amount_cents
    ELSE ledger_transaction.amount_cents
  END;

  IF NEW.balance_cents IS DISTINCT FROM expected_balance
     OR NEW.ledger_version <> OLD.ledger_version + 1
     OR NULLIF(BTRIM(NEW.last_entry_hash), '') IS NULL
     OR NEW.last_posted_at IS NULL THEN
    RAISE EXCEPTION 'OxSteed Credit account update does not match its journal transaction'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_account_ledger_write_guard ON oxsteed_credit_accounts;

CREATE TRIGGER oxsteed_credit_account_ledger_write_guard
  BEFORE INSERT OR UPDATE OF balance_cents, ledger_version, last_entry_hash, last_posted_at
  ON oxsteed_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_account_ledger_write();
