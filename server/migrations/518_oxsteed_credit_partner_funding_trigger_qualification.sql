-- Migration 518: qualify the funding trigger's transaction columns.
--
-- The variable named transaction_type in migration 514 collides with the
-- selected column in PostgreSQL's PL/pgSQL name resolution. Keep the guard
-- explicit so the immutable funding-record check cannot fail with an
-- ambiguous-column error.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_partner_funding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ledger_partner BIGINT;
  ledger_currency CHAR(3);
  ledger_reserve BIGINT;
  funding_transaction_type VARCHAR(32);
  transaction_partner BIGINT;
  transaction_currency CHAR(3);
  transaction_debit BIGINT;
  transaction_credit BIGINT;
BEGIN
  SELECT l.partner_id, l.currency_code, l.reserve_account_id
    INTO ledger_partner, ledger_currency, ledger_reserve
    FROM oxsteed_credit_partner_ledgers l
   WHERE l.id = NEW.partner_ledger_id;

  SELECT t.transaction_type, t.partner_id, t.currency_code,
         t.debit_account_id, t.credit_account_id
    INTO funding_transaction_type, transaction_partner, transaction_currency,
         transaction_debit, transaction_credit
    FROM oxsteed_credit_transactions t
   WHERE t.id = NEW.transaction_id;

  IF ledger_partner IS DISTINCT FROM NEW.partner_id
     OR ledger_currency IS DISTINCT FROM NEW.currency_code
     OR ledger_reserve IS DISTINCT FROM NEW.reserve_account_id
     OR transaction_partner IS DISTINCT FROM NEW.partner_id
     OR transaction_currency IS DISTINCT FROM NEW.currency_code
     OR funding_transaction_type IS DISTINCT FROM (CASE NEW.direction
       WHEN 'fund' THEN 'funding' ELSE 'reserve_release' END)
     OR (NEW.direction = 'fund' AND transaction_credit IS DISTINCT FROM NEW.reserve_account_id)
     OR (NEW.direction = 'release' AND transaction_debit IS DISTINCT FROM NEW.reserve_account_id) THEN
    RAISE EXCEPTION 'OxSteed Credit funding record does not match its ledger transaction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
