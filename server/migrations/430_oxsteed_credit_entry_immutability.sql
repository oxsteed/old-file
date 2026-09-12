-- Migration 430: keep OxSteed Credit journal entries append-only.
--
-- Corrections must be represented by a compensating transaction. Editing or
-- deleting an entry would invalidate the account hash chain and reconciliation.

CREATE OR REPLACE FUNCTION reject_oxsteed_credit_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OxSteed Credit journal entries are append-only; post a compensating transaction'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_entry_immutable_guard ON oxsteed_credit_transaction_entries;

CREATE TRIGGER oxsteed_credit_entry_immutable_guard
  BEFORE UPDATE OR DELETE ON oxsteed_credit_transaction_entries
  FOR EACH ROW
  EXECUTE FUNCTION reject_oxsteed_credit_entry_mutation();
