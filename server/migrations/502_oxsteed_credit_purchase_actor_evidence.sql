-- Migration 502: bind non-customer Credit purchases to a captured hold.
--
-- Customer checkout records the customer as the actor. The only supported
-- non-customer purchase writer is hold capture, which must carry the hold id
-- in metadata. Older rows that cannot be reconstructed remain visible with a
-- legacy marker instead of being deleted or relabeled.

ALTER TABLE oxsteed_credit_transactions
  ADD COLUMN IF NOT EXISTS purchase_actor_evidence_legacy BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE oxsteed_credit_transactions t
   SET purchase_actor_evidence_legacy = TRUE
 WHERE t.purchase_actor_evidence_legacy = FALSE
   AND t.transaction_type = 'purchase'
   AND (
     t.actor_type IS NULL
     OR t.actor_type NOT IN ('customer', 'user', 'admin', 'system')
     OR (
       t.actor_type IN ('customer', 'user')
       AND NOT EXISTS (
         SELECT 1
           FROM oxsteed_credit_accounts a
           JOIN users u ON u.id = a.customer_id
          WHERE a.id = t.debit_account_id
            AND a.account_type = 'customer_wallet'
            AND a.customer_id = t.actor_user_id
            AND u.role = 'customer'
            AND u.is_active = TRUE
       )
     )
     OR (
       t.actor_type = 'admin'
       AND (
         NOT EXISTS (
           SELECT 1
             FROM users u
            WHERE u.id = t.actor_user_id
              AND u.role IN ('admin', 'super_admin')
              AND u.is_active = TRUE
         )
         OR NOT EXISTS (
           SELECT 1
             FROM oxsteed_credit_holds h
             JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id
            WHERE h.id::TEXT = t.metadata->>'capturedHoldId'
              AND h.account_id = t.debit_account_id
              AND h.customer_id = a.customer_id
              AND h.amount_cents = t.amount_cents
              AND h.currency_code = t.currency_code
              AND h.partner_id = t.partner_id
              AND h.agreement_id = t.agreement_id
              AND h.status IN ('active', 'captured')
              AND (h.status = 'active' OR h.captured_transaction_id = t.id)
         )
       )
     )
     OR (
       t.actor_type = 'system'
       AND NOT EXISTS (
         SELECT 1
           FROM oxsteed_credit_holds h
           JOIN oxsteed_credit_accounts a ON a.id = t.debit_account_id
          WHERE h.id::TEXT = t.metadata->>'capturedHoldId'
            AND h.account_id = t.debit_account_id
            AND h.customer_id = a.customer_id
            AND h.amount_cents = t.amount_cents
            AND h.currency_code = t.currency_code
            AND h.partner_id = t.partner_id
            AND h.agreement_id = t.agreement_id
            AND h.status IN ('active', 'captured')
            AND (h.status = 'active' OR h.captured_transaction_id = t.id)
       )
     )
   );

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_purchase_actor_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  hold_capture_valid BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.purchase_actor_evidence_legacy THEN
    RAISE EXCEPTION 'New OxSteed Credit purchases cannot use legacy actor evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.purchase_actor_evidence_legacy
     AND NOT NEW.purchase_actor_evidence_legacy THEN
    RAISE EXCEPTION 'Legacy Credit purchase actor evidence cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.transaction_type = 'purchase'
     AND NOT NEW.purchase_actor_evidence_legacy THEN
    IF NEW.actor_type IS NULL OR NEW.actor_type NOT IN ('customer', 'user', 'admin', 'system') THEN
      RAISE EXCEPTION 'OxSteed Credit purchases require a supported actor type'
        USING ERRCODE = '23514';
    ELSIF NEW.actor_type IN ('customer', 'user') THEN
      RETURN NEW;
    ELSIF NEW.actor_type = 'admin' THEN
      SELECT EXISTS (
        SELECT 1
          FROM oxsteed_credit_holds h
          JOIN oxsteed_credit_accounts a ON a.id = NEW.debit_account_id
         WHERE h.id::TEXT = NEW.metadata->>'capturedHoldId'
           AND h.account_id = NEW.debit_account_id
           AND h.customer_id = a.customer_id
           AND h.amount_cents = NEW.amount_cents
           AND h.currency_code = NEW.currency_code
           AND h.partner_id = NEW.partner_id
           AND h.agreement_id = NEW.agreement_id
           AND h.status IN ('active', 'captured')
           AND (h.status = 'active' OR h.captured_transaction_id = NEW.id)
      ) INTO hold_capture_valid;
    ELSIF NEW.actor_type = 'system' THEN
      SELECT EXISTS (
        SELECT 1
          FROM oxsteed_credit_holds h
          JOIN oxsteed_credit_accounts a ON a.id = NEW.debit_account_id
         WHERE h.id::TEXT = NEW.metadata->>'capturedHoldId'
           AND h.account_id = NEW.debit_account_id
           AND h.customer_id = a.customer_id
           AND h.amount_cents = NEW.amount_cents
           AND h.currency_code = NEW.currency_code
           AND h.partner_id = NEW.partner_id
           AND h.agreement_id = NEW.agreement_id
           AND h.status IN ('active', 'captured')
           AND (h.status = 'active' OR h.captured_transaction_id = NEW.id)
      ) INTO hold_capture_valid;
    ELSE
      hold_capture_valid := FALSE;
    END IF;

    IF NEW.actor_type IN ('admin', 'system') AND NOT hold_capture_valid THEN
      RAISE EXCEPTION 'Non-customer OxSteed Credit purchases require a matching hold capture'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_purchase_actor_evidence_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_purchase_actor_evidence_guard
  BEFORE INSERT OR UPDATE OF transaction_type, actor_type, actor_user_id,
    debit_account_id, credit_account_id, amount_cents, currency_code,
    partner_id, agreement_id, metadata, purchase_actor_evidence_legacy
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_purchase_actor_evidence();
