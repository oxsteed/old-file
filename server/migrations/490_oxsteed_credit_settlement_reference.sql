-- Migration 490: bind every settlement journal entry to one payout snapshot.
--
-- Account direction alone does not prove what a payout represents. Require a
-- matching approved/paid settlement and reject duplicate journal movements for
-- the same settlement reference, including concurrent direct SQL writers.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement RECORD;
BEGIN
  IF NEW.transaction_type <> 'settlement' THEN
    RETURN NEW;
  END IF;

  IF NEW.reference_type IS DISTINCT FROM 'credit_settlement'
     OR NULLIF(BTRIM(NEW.reference_id), '') IS NULL THEN
    RAISE EXCEPTION 'OxSteed Credit settlement transactions require a settlement reference'
      USING ERRCODE = '23514';
  END IF;

  SELECT s.id, s.status, s.partner_id, s.agreement_id, s.net_cents, s.currency_code
    INTO settlement
    FROM oxsteed_credit_settlements s
   WHERE s.id::TEXT = NEW.reference_id
   LIMIT 1;

  IF NOT FOUND
     OR settlement.status NOT IN ('approved', 'paid')
     OR settlement.partner_id IS DISTINCT FROM NEW.partner_id
     OR settlement.agreement_id IS DISTINCT FROM NEW.agreement_id
     OR settlement.net_cents IS DISTINCT FROM NEW.amount_cents
     OR settlement.currency_code IS DISTINCT FROM NEW.currency_code THEN
    RAISE EXCEPTION 'OxSteed Credit settlement transactions require a matching approved settlement snapshot'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(CONCAT('oxsteed-credit-settlement-reference:', NEW.reference_id), 0)
  );

  IF EXISTS (
    SELECT 1
      FROM oxsteed_credit_transactions existing
     WHERE existing.transaction_type = 'settlement'
       AND existing.status = 'posted'
       AND existing.reference_type = NEW.reference_type
       AND existing.reference_id = NEW.reference_id
       AND existing.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'An OxSteed Credit settlement snapshot already has a posted journal payment'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_reference_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_settlement_reference_guard
  BEFORE INSERT OR UPDATE OF transaction_type, status, amount_cents, currency_code,
    partner_id, agreement_id, reference_type, reference_id
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_reference();
