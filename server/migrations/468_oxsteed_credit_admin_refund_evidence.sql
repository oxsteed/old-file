-- Migration 468: administrative Credit refunds require accountable evidence.
--
-- Automated and restaurant-operated order reversals use their own actor types.
-- Only the explicit admin actor is required to carry an operator identity and
-- a reason, so direct SQL cannot create an untraceable administrative refund.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_admin_refund_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_type = 'refund'
     AND NEW.actor_type = 'admin'
     AND (NEW.actor_user_id IS NULL OR NULLIF(BTRIM(NEW.reason), '') IS NULL) THEN
    RAISE EXCEPTION 'Administrative OxSteed Credit refunds require an actor and reason'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_admin_refund_evidence_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_admin_refund_evidence_guard
  BEFORE INSERT OR UPDATE OF transaction_type, actor_type, actor_user_id, reason
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_admin_refund_evidence();
