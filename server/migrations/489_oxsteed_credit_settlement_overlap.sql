-- Migration 489: enforce one non-voided settlement per partner period.
--
-- The service serializes settlement creation, but the database is the final
-- boundary for maintenance scripts and future workers running elsewhere.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'voided' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        CONCAT('oxsteed-credit-settlement-period:', NEW.partner_id, ':', NEW.agreement_id),
        0
      )
    );

    IF EXISTS (
      SELECT 1
        FROM oxsteed_credit_settlements existing
       WHERE existing.partner_id = NEW.partner_id
         AND existing.agreement_id = NEW.agreement_id
         AND existing.status <> 'voided'
         AND existing.id IS DISTINCT FROM NEW.id
         AND existing.period_start < NEW.period_end
         AND existing.period_end > NEW.period_start
    ) THEN
      RAISE EXCEPTION 'OxSteed Credit settlement period overlaps an existing non-voided settlement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_overlap_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_overlap_guard
  BEFORE INSERT OR UPDATE OF status, partner_id, agreement_id, period_start, period_end
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_overlap();
