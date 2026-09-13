-- Migration 462: reserve ledger transaction types without audited posting flows.
--
-- fee, expiration, and chargeback remain in the historical schema so existing
-- records can be reported, but they must not be posted until each movement has
-- a complete service, authorization, audit, and reconciliation contract.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_types()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_type VARCHAR(32);
  credit_type VARCHAR(32);
  expected_direction_valid BOOLEAN := TRUE;
BEGIN
  SELECT account_type INTO debit_type
    FROM oxsteed_credit_accounts
   WHERE id = NEW.debit_account_id;
  SELECT account_type INTO credit_type
    FROM oxsteed_credit_accounts
   WHERE id = NEW.credit_account_id;

  IF NEW.transaction_type = 'load' THEN
    expected_direction_valid := debit_type = 'platform_treasury'
      AND credit_type = 'customer_wallet'
      AND NEW.partner_id IS NULL
      AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'purchase' THEN
    expected_direction_valid := debit_type = 'customer_wallet'
      AND credit_type = 'partner_payable';
  ELSIF NEW.transaction_type = 'refund' THEN
    expected_direction_valid := debit_type = 'partner_payable'
      AND credit_type = 'customer_wallet';
  ELSIF NEW.transaction_type = 'transfer' THEN
    expected_direction_valid := debit_type = 'customer_wallet'
      AND credit_type = 'customer_wallet'
      AND NEW.partner_id IS NULL
      AND NEW.agreement_id IS NULL;
  ELSIF NEW.transaction_type = 'settlement' THEN
    expected_direction_valid := debit_type = 'partner_payable'
      AND credit_type = 'platform_treasury'
      AND NEW.partner_id IS NOT NULL
      AND NEW.agreement_id IS NOT NULL;
  ELSIF NEW.transaction_type = 'adjustment' THEN
    expected_direction_valid := NEW.partner_id IS NULL
      AND NEW.agreement_id IS NULL
      AND CASE NEW.metadata->>'direction'
        WHEN 'credit' THEN debit_type = 'platform_treasury'
          AND credit_type = 'customer_wallet'
        WHEN 'debit' THEN debit_type = 'customer_wallet'
          AND credit_type = 'platform_treasury'
        ELSE FALSE
      END;
  ELSIF NEW.transaction_type IN ('fee', 'expiration', 'chargeback') THEN
    expected_direction_valid := FALSE;
  END IF;

  IF NOT expected_direction_valid THEN
    RAISE EXCEPTION 'OxSteed Credit transaction account direction is invalid or the transaction type is reserved'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_type_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_type_guard
  BEFORE INSERT OR UPDATE OF debit_account_id, credit_account_id, transaction_type, partner_id, agreement_id, metadata
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_types();
