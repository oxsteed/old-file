-- Migration 429: keep settlements aligned with their partner agreement.
--
-- Settlement rows are payable records. Their partner, agreement, and currency
-- must agree even when a maintenance script bypasses the application service.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement_partner_id BIGINT;
  agreement_currency CHAR(3);
BEGIN
  SELECT a.partner_id, p.settlement_currency_code
    INTO agreement_partner_id, agreement_currency
    FROM oxsteed_credit_partner_agreements a
    JOIN oxsteed_credit_partners p ON p.id = a.partner_id
   WHERE a.id = NEW.agreement_id;

  IF agreement_partner_id IS NULL
     OR agreement_partner_id IS DISTINCT FROM NEW.partner_id
     OR agreement_currency IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit settlement does not match its partner agreement'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_integrity_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_integrity_guard
  BEFORE INSERT OR UPDATE OF partner_id, agreement_id, currency_code
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_integrity();
