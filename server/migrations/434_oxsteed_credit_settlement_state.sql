-- Migration 434: enforce OxSteed Credit settlement state transitions.
--
-- Settlement status changes represent payable-money decisions. Keep the
-- application state machine below the API so direct SQL cannot skip approval
-- or mark a non-zero settlement paid without payment evidence.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('approved', 'disputed', 'voided'))
      OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'disputed', 'voided'))
      OR (OLD.status = 'paid' AND NEW.status = 'disputed')
      OR (OLD.status = 'disputed' AND NEW.status IN ('approved', 'voided'))
    ) THEN
      RAISE EXCEPTION 'Invalid OxSteed Credit settlement status transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'paid' THEN
    IF NEW.net_cents > 0 AND NULLIF(BTRIM(NEW.payment_reference), '') IS NULL THEN
      RAISE EXCEPTION 'A non-zero OxSteed Credit settlement requires a payment reference'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.paid_at IS NULL THEN
      RAISE EXCEPTION 'A paid OxSteed Credit settlement requires a paid timestamp'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_state_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_state_guard
  BEFORE INSERT OR UPDATE OF status, net_cents, payment_reference, paid_at
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_state();
