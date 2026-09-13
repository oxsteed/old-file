-- Migration 448: protect OxSteed Credit settlement snapshots.
--
-- A settlement is a payable snapshot of an agreement period. Its identity and
-- calculated totals must not change after creation, even if a maintenance
-- script or future endpoint writes directly to the database. Status,
-- approval, payment evidence, and audit metadata remain the only mutable
-- lifecycle fields.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.partner_id IS DISTINCT FROM OLD.partner_id
       OR NEW.agreement_id IS DISTINCT FROM OLD.agreement_id
       OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.gross_cents IS DISTINCT FROM OLD.gross_cents
       OR NEW.refund_cents IS DISTINCT FROM OLD.refund_cents
       OR NEW.fee_cents IS DISTINCT FROM OLD.fee_cents
       OR NEW.net_cents IS DISTINCT FROM OLD.net_cents
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'OxSteed Credit settlement snapshot fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('approved', 'paid') AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'An approved or paid OxSteed Credit settlement requires approval evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_immutability_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_immutability_guard
  BEFORE INSERT OR UPDATE OF partner_id, agreement_id, currency_code, period_start,
    period_end, gross_cents, refund_cents, fee_cents, net_cents, idempotency_key,
    created_by, created_at, status, approved_by
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_immutability();
