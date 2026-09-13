-- Migration 497: bind customer Credit transaction actors to the debited wallet owner.
--
-- Role validation alone is not enough: a customer actor must be the owner of
-- the wallet whose balance is being spent. Historical rows that cannot be
-- reconstructed are retained with an explicit marker and excluded from the
-- new-record invariant.

ALTER TABLE oxsteed_credit_transactions
  ADD COLUMN IF NOT EXISTS actor_owner_evidence_legacy BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE oxsteed_credit_transactions t
   SET actor_owner_evidence_legacy = TRUE
 WHERE t.actor_owner_evidence_legacy = FALSE
   AND t.actor_type IN ('user', 'customer')
   AND (
     t.actor_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM oxsteed_credit_accounts a
        WHERE a.id = t.debit_account_id
          AND a.account_type = 'customer_wallet'
          AND a.customer_id = t.actor_user_id
     )
   );

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_actor_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  wallet_owner UUID;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.actor_owner_evidence_legacy THEN
    RAISE EXCEPTION 'New OxSteed Credit transactions cannot use legacy actor-owner evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.actor_owner_evidence_legacy
     AND NOT NEW.actor_owner_evidence_legacy THEN
    RAISE EXCEPTION 'Legacy Credit transaction actor-owner evidence cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.actor_type IN ('user', 'customer')
     AND NOT NEW.actor_owner_evidence_legacy THEN
    SELECT a.customer_id
      INTO wallet_owner
      FROM oxsteed_credit_accounts a
     WHERE a.id = NEW.debit_account_id
       AND a.account_type = 'customer_wallet';

    IF wallet_owner IS NULL OR NEW.actor_user_id IS DISTINCT FROM wallet_owner THEN
      RAISE EXCEPTION 'Customer Credit transaction actor must own the debited wallet'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_actor_owner_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_actor_owner_guard
  BEFORE INSERT OR UPDATE OF actor_type, actor_user_id, debit_account_id,
    actor_owner_evidence_legacy
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_actor_owner();
