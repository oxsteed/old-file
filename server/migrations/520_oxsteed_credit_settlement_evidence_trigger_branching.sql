-- Migration 520: keep the shared settlement-evidence trigger table-safe.
--
-- PostgreSQL may evaluate both sides of a boolean expression. The migration
-- 515 function therefore attempted to read transaction-only fields from a
-- settlement row. Branch on TG_TABLE_NAME before touching row-specific fields.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_payment_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matching_transaction_count INTEGER;
  new_net_cents BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'oxsteed_credit_settlements' THEN
    IF NEW.status = 'paid' AND COALESCE(NULLIF(to_jsonb(NEW)->>'net_cents', '')::BIGINT, 0) > 0 THEN
      new_net_cents := NULLIF(to_jsonb(NEW)->>'net_cents', '')::BIGINT;
      SELECT COUNT(*)::INTEGER
        INTO matching_transaction_count
        FROM oxsteed_credit_transactions t
       WHERE t.transaction_type = 'settlement'
         AND t.status = 'posted'
         AND t.partner_id = NEW.partner_id
         AND t.agreement_id = NEW.agreement_id
         AND t.amount_cents = new_net_cents
         AND t.currency_code = NEW.currency_code
         AND t.reference_type = 'credit_settlement'
         AND t.reference_id = NEW.id::TEXT
         AND t.metadata->>'paymentReference' = NEW.payment_reference;

      IF matching_transaction_count <> 1 THEN
        RAISE EXCEPTION 'A paid OxSteed Credit settlement requires one matching journal payment'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'oxsteed_credit_transactions' THEN
    IF NEW.transaction_type = 'settlement'
       AND NEW.status = 'posted'
       AND NEW.reference_type = 'credit_settlement'
       AND EXISTS (
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
