-- Migration 425: keep OxSteed Credit transaction headers append-only.
--
-- Corrections must be represented by a compensating transaction. Updating a
-- transaction header after its journal entries exist would invalidate the
-- HMAC chain and make reconciliation unreliable.

CREATE OR REPLACE FUNCTION reject_oxsteed_credit_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OxSteed Credit transactions are append-only; post a compensating transaction'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_immutable_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_immutable_guard
  BEFORE UPDATE OR DELETE ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION reject_oxsteed_credit_transaction_mutation();
