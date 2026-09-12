-- Migration 426: database-level OxSteed Credit hold integrity.
--
-- Holds reserve a customer wallet for one partner agreement. Keep those
-- references aligned even when a maintenance script bypasses the API.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_hold_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_customer_id UUID;
  account_currency CHAR(3);
  account_kind VARCHAR(32);
  agreement_partner_id BIGINT;
  agreement_currency CHAR(3);
BEGIN
  SELECT customer_id, currency_code, account_type
    INTO account_customer_id, account_currency, account_kind
    FROM oxsteed_credit_accounts
   WHERE id = NEW.account_id;

  IF account_kind IS DISTINCT FROM 'customer_wallet'
     OR account_customer_id IS DISTINCT FROM NEW.customer_id
     OR account_currency IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit hold account does not match its customer and currency'
      USING ERRCODE = '23514';
  END IF;

  SELECT a.partner_id, p.settlement_currency_code
    INTO agreement_partner_id, agreement_currency
    FROM oxsteed_credit_partner_agreements a
    JOIN oxsteed_credit_partners p ON p.id = a.partner_id
   WHERE a.id = NEW.agreement_id;

  IF agreement_partner_id IS NULL
     OR agreement_partner_id IS DISTINCT FROM NEW.partner_id
     OR agreement_currency IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit hold agreement does not match its partner and currency'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_hold_integrity_guard ON oxsteed_credit_holds;

CREATE TRIGGER oxsteed_credit_hold_integrity_guard
  BEFORE INSERT OR UPDATE OF account_id, customer_id, partner_id, agreement_id, currency_code
  ON oxsteed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_hold_integrity();
