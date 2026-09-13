-- Migration 466: bind paid settlement evidence to its journal transaction.
--
-- A non-zero paid settlement must have exactly the matching posted settlement
-- movement, including the external payment reference recorded in metadata.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_payment_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matching_transaction_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'oxsteed_credit_settlements' AND NEW.status = 'paid' AND NEW.net_cents > 0 THEN
    SELECT COUNT(*)::INTEGER
      INTO matching_transaction_count
      FROM oxsteed_credit_transactions t
     WHERE t.transaction_type = 'settlement'
       AND t.status = 'posted'
       AND t.partner_id = NEW.partner_id
       AND t.agreement_id = NEW.agreement_id
       AND t.amount_cents = NEW.net_cents
       AND t.currency_code = NEW.currency_code
       AND t.reference_type = 'credit_settlement'
       AND t.reference_id = NEW.id::TEXT
       AND t.metadata->>'paymentReference' = NEW.payment_reference;

    IF matching_transaction_count <> 1 THEN
      RAISE EXCEPTION 'A paid OxSteed Credit settlement requires one matching journal payment'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'oxsteed_credit_transactions'
        AND NEW.transaction_type = 'settlement'
        AND NEW.status = 'posted'
        AND NEW.reference_type = 'credit_settlement' THEN
    IF EXISTS (
      SELECT 1
        FROM oxsteed_credit_settlements s
       WHERE s.id::TEXT = NEW.reference_id
         AND s.status = 'paid'
         AND (s.net_cents <> NEW.amount_cents
           OR s.currency_code IS DISTINCT FROM NEW.currency_code
           OR s.partner_id IS DISTINCT FROM NEW.partner_id
           OR s.agreement_id IS DISTINCT FROM NEW.agreement_id
           OR s.payment_reference IS DISTINCT FROM NEW.metadata->>'paymentReference')
    ) THEN
      RAISE EXCEPTION 'Credit settlement journal evidence does not match the paid settlement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_payment_evidence_guard ON oxsteed_credit_settlements;

CREATE CONSTRAINT TRIGGER oxsteed_credit_settlement_payment_evidence_guard
  AFTER INSERT OR UPDATE OF status, net_cents, currency_code, partner_id, agreement_id, payment_reference
  ON oxsteed_credit_settlements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_payment_evidence();

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_settlement_evidence_guard ON oxsteed_credit_transactions;

CREATE CONSTRAINT TRIGGER oxsteed_credit_transaction_settlement_evidence_guard
  AFTER INSERT
  ON oxsteed_credit_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_payment_evidence();
