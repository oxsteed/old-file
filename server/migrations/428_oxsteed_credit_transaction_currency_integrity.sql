-- Migration 428: keep transaction currency aligned with its agreement.
--
-- The application currently supports USD only, but the database must reject a
-- mismatched agreement currency even if a maintenance script bypasses the API.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_transaction_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement_currency CHAR(3);
BEGIN
  IF NEW.agreement_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.settlement_currency_code
    INTO agreement_currency
    FROM oxsteed_credit_partner_agreements a
    JOIN oxsteed_credit_partners p ON p.id = a.partner_id
   WHERE a.id = NEW.agreement_id;

  IF agreement_currency IS NULL
     OR agreement_currency IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit transaction currency does not match its agreement'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_transaction_currency_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_transaction_currency_guard
  BEFORE INSERT OR UPDATE OF agreement_id, currency_code
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_transaction_currency();
