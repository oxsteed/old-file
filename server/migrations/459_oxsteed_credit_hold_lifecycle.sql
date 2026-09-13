-- Migration 459: keep OxSteed Credit hold lifecycle records self-consistent.
--
-- Holds reserve customer value before a purchase is posted. A captured hold
-- must point to the exact posted purchase that consumed that reservation, and
-- released/expired holds must prove when the reservation was returned.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_hold_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_transaction RECORD;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       OLD.status = 'active'
       AND NEW.status IN ('captured', 'released', 'expired')
     ) THEN
    RAISE EXCEPTION 'Invalid OxSteed Credit hold status transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    IF NEW.captured_transaction_id IS NOT NULL
       OR NEW.capture_idempotency_key IS NOT NULL
       OR NEW.captured_at IS NOT NULL
       OR NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'An active OxSteed Credit hold cannot contain terminal lifecycle evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status IN ('released', 'expired') THEN
    IF NEW.released_at IS NULL
       OR NEW.captured_transaction_id IS NOT NULL
       OR NEW.capture_idempotency_key IS NOT NULL
       OR NEW.captured_at IS NOT NULL THEN
      RAISE EXCEPTION 'A released or expired OxSteed Credit hold requires release evidence only'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'captured' THEN
    IF NEW.captured_transaction_id IS NULL
       OR NULLIF(BTRIM(NEW.capture_idempotency_key), '') IS NULL
       OR NEW.captured_at IS NULL
       OR NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'A captured OxSteed Credit hold requires capture evidence'
        USING ERRCODE = '23514';
    END IF;

    SELECT t.transaction_type,
           t.status,
           t.debit_account_id,
           t.credit_account_id,
           t.amount_cents,
           t.currency_code,
           t.partner_id,
           t.agreement_id
      INTO purchase_transaction
      FROM oxsteed_credit_transactions t
     WHERE t.id = NEW.captured_transaction_id;

    IF NOT FOUND
       OR purchase_transaction.transaction_type <> 'purchase'
       OR purchase_transaction.status <> 'posted'
       OR purchase_transaction.debit_account_id IS DISTINCT FROM NEW.account_id
       OR purchase_transaction.amount_cents IS DISTINCT FROM NEW.amount_cents
       OR purchase_transaction.currency_code IS DISTINCT FROM NEW.currency_code
       OR purchase_transaction.partner_id IS DISTINCT FROM NEW.partner_id
       OR purchase_transaction.agreement_id IS DISTINCT FROM NEW.agreement_id THEN
      RAISE EXCEPTION 'A captured OxSteed Credit hold must link to its matching posted purchase'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_lifecycle_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_lifecycle_guard
  BEFORE INSERT OR UPDATE
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_hold_lifecycle();
