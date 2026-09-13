-- Migration 463: require evidence for every Credit dispute status change.
--
-- Review is a financial workflow transition, not a no-op. Keep an operator
-- note with it so the audit event can explain who moved the case and why.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_dispute_status_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('in_review', 'resolved', 'rejected')
     AND NULLIF(BTRIM(NEW.resolution), '') IS NULL THEN
    RAISE EXCEPTION 'A Credit dispute status change requires a note'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_dispute_status_evidence_guard ON oxsteed_credit_disputes;

CREATE TRIGGER oxsteed_credit_dispute_status_evidence_guard
  BEFORE INSERT OR UPDATE OF status, resolution
  ON oxsteed_credit_disputes
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_dispute_status_evidence();
