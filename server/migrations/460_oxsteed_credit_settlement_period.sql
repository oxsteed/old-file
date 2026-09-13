-- Migration 460: keep settlement snapshots inside their agreement boundary.
--
-- Expired and suspended agreements remain settlement-capable for historical
-- activity. Draft, approval-pending, and terminated agreements do not.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement_partner_id BIGINT;
  agreement_currency CHAR(3);
  agreement_status VARCHAR(24);
  agreement_starts_at TIMESTAMPTZ;
  agreement_ends_at TIMESTAMPTZ;
BEGIN
  SELECT a.partner_id,
         p.settlement_currency_code,
         a.status,
         a.starts_at,
         a.ends_at
    INTO agreement_partner_id,
         agreement_currency,
         agreement_status,
         agreement_starts_at,
         agreement_ends_at
    FROM oxsteed_credit_partner_agreements a
    JOIN oxsteed_credit_partners p ON p.id = a.partner_id
   WHERE a.id = NEW.agreement_id;

  IF agreement_partner_id IS NULL
     OR agreement_partner_id IS DISTINCT FROM NEW.partner_id
     OR agreement_currency IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit settlement does not match its partner agreement'
      USING ERRCODE = '23514';
  END IF;

  IF agreement_status NOT IN ('active', 'suspended', 'expired') THEN
    RAISE EXCEPTION 'OxSteed Credit settlement requires a settlement-capable agreement'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.period_start < agreement_starts_at
     OR (agreement_ends_at IS NOT NULL AND NEW.period_end > agreement_ends_at) THEN
    RAISE EXCEPTION 'OxSteed Credit settlement period must fall within its agreement dates'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_integrity_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_integrity_guard
  BEFORE INSERT OR UPDATE OF partner_id, agreement_id, currency_code, period_start, period_end
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_integrity();
