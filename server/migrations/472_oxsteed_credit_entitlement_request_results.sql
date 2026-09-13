-- Keep the committed result for entitlement idempotency keys. A retry should
-- return the original grant, even if the entitlement was edited later.
ALTER TABLE oxsteed_credit_entitlement_bulk_requests
  ADD COLUMN IF NOT EXISTS response_payload JSONB;

ALTER TABLE oxsteed_credit_entitlement_requests
  ADD COLUMN IF NOT EXISTS response_payload JSONB;

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_entitlement_request()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OxSteed Credit entitlement request records are append-only'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'OxSteed Credit entitlement request identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_TABLE_NAME = 'oxsteed_credit_entitlement_bulk_requests'
     AND NEW.agreement_ids IS DISTINCT FROM OLD.agreement_ids THEN
    RAISE EXCEPTION 'OxSteed Credit entitlement request identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  ELSIF TG_TABLE_NAME = 'oxsteed_credit_entitlement_requests'
     AND NEW.agreement_id IS DISTINCT FROM OLD.agreement_id THEN
    RAISE EXCEPTION 'OxSteed Credit entitlement request identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.response_payload IS NOT NULL
     AND NEW.response_payload IS DISTINCT FROM OLD.response_payload THEN
    RAISE EXCEPTION 'OxSteed Credit entitlement request result is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_entitlement_bulk_request_immutable_guard
  ON oxsteed_credit_entitlement_bulk_requests;
CREATE TRIGGER oxsteed_credit_entitlement_bulk_request_immutable_guard
BEFORE UPDATE OR DELETE ON oxsteed_credit_entitlement_bulk_requests
FOR EACH ROW
EXECUTE FUNCTION validate_oxsteed_credit_entitlement_request();

DROP TRIGGER IF EXISTS oxsteed_credit_entitlement_request_immutable_guard
  ON oxsteed_credit_entitlement_requests;
CREATE TRIGGER oxsteed_credit_entitlement_request_immutable_guard
BEFORE UPDATE OR DELETE ON oxsteed_credit_entitlement_requests
FOR EACH ROW
EXECUTE FUNCTION validate_oxsteed_credit_entitlement_request();
