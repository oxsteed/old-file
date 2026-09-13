-- Migration 452: keep Credit disputes tied to the correct customer ledger.
--
-- Disputes are customer-facing financial records. Enforce the same ownership
-- and lifecycle rules below the API so a maintenance path cannot attach a
-- dispute to another customer's transaction or skip the review workflow.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_dispute_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_partner_id BIGINT;
  transaction_currency CHAR(3);
  transaction_status VARCHAR(20);
  customer_owns_transaction BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
  ) THEN
    RAISE EXCEPTION 'OxSteed Credit dispute ownership cannot change after it is opened'
      USING ERRCODE = '23514';
  END IF;

  SELECT t.partner_id, t.currency_code, t.status
    INTO transaction_partner_id, transaction_currency, transaction_status
    FROM oxsteed_credit_transactions t
   WHERE t.id = NEW.transaction_id;

  IF transaction_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'OxSteed Credit disputes require a posted transaction'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM oxsteed_credit_accounts a
      JOIN users u ON u.id = a.customer_id
     WHERE a.id IN (
       SELECT t.debit_account_id
         FROM oxsteed_credit_transactions t
        WHERE t.id = NEW.transaction_id
       UNION
       SELECT t.credit_account_id
         FROM oxsteed_credit_transactions t
        WHERE t.id = NEW.transaction_id
     )
       AND a.account_type = 'customer_wallet'
       AND a.customer_id = NEW.customer_id
       AND a.currency_code IS NOT DISTINCT FROM transaction_currency
       AND u.role = 'customer'
  )
    INTO customer_owns_transaction;

  IF NOT customer_owns_transaction THEN
    RAISE EXCEPTION 'OxSteed Credit dispute customer does not own the transaction'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.partner_id IS DISTINCT FROM transaction_partner_id THEN
    RAISE EXCEPTION 'OxSteed Credit dispute partner does not match the transaction'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'open' AND NEW.status IN ('in_review', 'resolved', 'rejected'))
      OR (OLD.status = 'in_review' AND NEW.status IN ('resolved', 'rejected'))
    ) THEN
      RAISE EXCEPTION 'Invalid OxSteed Credit dispute status transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('resolved', 'rejected') THEN
    IF NULLIF(BTRIM(NEW.resolution), '') IS NULL
       OR NEW.resolved_by IS NULL
       OR NEW.resolved_at IS NULL THEN
      RAISE EXCEPTION 'A closed OxSteed Credit dispute requires resolution evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_dispute_integrity_guard ON oxsteed_credit_disputes;

CREATE TRIGGER oxsteed_credit_dispute_integrity_guard
  BEFORE INSERT OR UPDATE
  ON oxsteed_credit_disputes
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_dispute_integrity();
