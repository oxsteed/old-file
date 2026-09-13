-- Migration 487: make administrative Credit issuance attributable.
--
-- Credit transaction safeguards already refer to a transaction reason, but the
-- original foundation table did not persist one. Keep old rows identifiable
-- without inventing a historical explanation, while rejecting that placeholder
-- for all new administrative loads and adjustments.

ALTER TABLE oxsteed_credit_transactions
  ADD COLUMN IF NOT EXISTS reason VARCHAR(500)
    DEFAULT 'Legacy transaction: reason unavailable';

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_issuance_actor_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_type IN ('load', 'adjustment')
     AND (NEW.actor_type <> 'admin'
       OR NEW.actor_user_id IS NULL
       OR NULLIF(BTRIM(NEW.reason), '') IS NULL
       OR NEW.reason = 'Legacy transaction: reason unavailable') THEN
    RAISE EXCEPTION 'OxSteed Credit issuance requires an administrator identity and reason'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_issuance_actor_evidence_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_issuance_actor_evidence_guard
  BEFORE INSERT OR UPDATE OF transaction_type, reason, actor_type, actor_user_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_issuance_actor_evidence();
