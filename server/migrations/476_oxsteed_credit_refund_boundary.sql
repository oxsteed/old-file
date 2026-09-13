-- Migration 476: keep Credit refunds tied to an original purchase.
--
-- The application already validates refunds. This database guard prevents a
-- maintenance script or future service from creating an unlinked refund or
-- refunding more than the original posted purchase.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_refund_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purchase RECORD;
  refunded_cents BIGINT;
BEGIN
  IF NEW.transaction_type <> 'refund' OR NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;

  IF NEW.reference_type IS DISTINCT FROM 'oxsteed_credit_purchase'
     OR NULLIF(BTRIM(NEW.reference_id), '') IS NULL THEN
    RAISE EXCEPTION 'OxSteed Credit refunds require an original purchase reference'
      USING ERRCODE = '23514';
  END IF;

  -- Serialize refunds for one purchase so concurrent callers cannot both pass
  -- the cumulative cap before either one commits.
  PERFORM pg_advisory_xact_lock(476, hashtext(NEW.reference_id));

  SELECT p.id,
         p.debit_account_id,
         p.credit_account_id,
         p.amount_cents,
         p.currency_code,
         p.partner_id,
         p.agreement_id
    INTO purchase
    FROM oxsteed_credit_transactions p
   WHERE p.id::TEXT = NEW.reference_id
     AND p.transaction_type = 'purchase'
     AND p.status = 'posted'
   FOR SHARE;

  IF NOT FOUND
     OR NEW.debit_account_id IS DISTINCT FROM purchase.credit_account_id
     OR NEW.credit_account_id IS DISTINCT FROM purchase.debit_account_id
     OR NEW.amount_cents <= 0
     OR NEW.currency_code IS DISTINCT FROM purchase.currency_code
     OR NEW.partner_id IS DISTINCT FROM purchase.partner_id
     OR NEW.agreement_id IS DISTINCT FROM purchase.agreement_id THEN
    RAISE EXCEPTION 'OxSteed Credit refund does not match its original purchase'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(r.amount_cents), 0)::BIGINT
    INTO refunded_cents
    FROM oxsteed_credit_transactions r
   WHERE r.transaction_type = 'refund'
     AND r.status = 'posted'
     AND r.reference_type = 'oxsteed_credit_purchase'
     AND r.reference_id = NEW.reference_id;

  IF refunded_cents + NEW.amount_cents > purchase.amount_cents THEN
    RAISE EXCEPTION 'OxSteed Credit refunds cannot exceed the original purchase'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_refund_boundary_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_refund_boundary_guard
  BEFORE INSERT
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_refund_boundary();
