-- Migration 469: keep Credit hold authorization details append-only.
--
-- A hold may move through its lifecycle, but its authorization identity must
-- not change underneath an active reservation or after capture.

CREATE OR REPLACE FUNCTION reject_oxsteed_credit_hold_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OxSteed Credit hold authorization is append-only'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.agreement_id IS DISTINCT FROM OLD.agreement_id
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
     OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'OxSteed Credit hold authorization is append-only'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_immutable_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_immutable_guard
  BEFORE UPDATE OR DELETE
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION reject_oxsteed_credit_hold_mutation();
