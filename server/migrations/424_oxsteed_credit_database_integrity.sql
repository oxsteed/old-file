-- Migration 424: database-level OxSteed Credit integrity guards.
--
-- Application validation is still required, but the ledger must also fail
-- closed when a maintenance script or future service writes directly to SQL.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_accounts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_currency CHAR(3);
  credit_currency CHAR(3);
  agreement_partner_id BIGINT;
BEGIN
  SELECT currency_code INTO debit_currency
    FROM oxsteed_credit_accounts
   WHERE id = NEW.debit_account_id;
  SELECT currency_code INTO credit_currency
    FROM oxsteed_credit_accounts
   WHERE id = NEW.credit_account_id;

  IF debit_currency IS DISTINCT FROM NEW.currency_code
     OR credit_currency IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit transaction accounts must share the transaction currency'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.transaction_type = 'purchase'
     AND (NEW.partner_id IS NULL OR NEW.agreement_id IS NULL) THEN
    RAISE EXCEPTION 'OxSteed Credit purchases require a partner and agreement'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.agreement_id IS NOT NULL THEN
    SELECT partner_id INTO agreement_partner_id
      FROM oxsteed_credit_partner_agreements
     WHERE id = NEW.agreement_id;
    IF agreement_partner_id IS NULL OR NEW.partner_id IS DISTINCT FROM agreement_partner_id THEN
      RAISE EXCEPTION 'OxSteed Credit transaction partner does not match its agreement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_account_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_account_guard
  BEFORE INSERT OR UPDATE OF debit_account_id, credit_account_id, currency_code, partner_id, agreement_id, transaction_type
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_accounts();

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_entries()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_amount BIGINT;
  transaction_debit_account BIGINT;
  transaction_credit_account BIGINT;
  entry_count INTEGER;
BEGIN
  SELECT amount_cents, debit_account_id, credit_account_id
    INTO transaction_amount, transaction_debit_account, transaction_credit_account
    FROM oxsteed_credit_transactions
   WHERE id = NEW.transaction_id;

  SELECT COUNT(*)::INTEGER INTO entry_count
    FROM oxsteed_credit_transaction_entries
   WHERE transaction_id = NEW.transaction_id;

  IF entry_count <> 2
     OR NOT EXISTS (
       SELECT 1 FROM oxsteed_credit_transaction_entries
        WHERE transaction_id = NEW.transaction_id
          AND account_id = transaction_debit_account
          AND entry_side = 'debit'
          AND amount_cents = transaction_amount
     )
     OR NOT EXISTS (
       SELECT 1 FROM oxsteed_credit_transaction_entries
        WHERE transaction_id = NEW.transaction_id
          AND account_id = transaction_credit_account
          AND entry_side = 'credit'
          AND amount_cents = transaction_amount
     ) THEN
    RAISE EXCEPTION 'OxSteed Credit transaction must have one matching debit and credit entry'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_entries_guard ON oxsteed_credit_transaction_entries;

CREATE CONSTRAINT TRIGGER oxsteed_credit_transaction_entries_guard
  AFTER INSERT ON oxsteed_credit_transaction_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_entries();
