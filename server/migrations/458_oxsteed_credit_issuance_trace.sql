-- Migration 458: require traceable references for Credit issuance.
--
-- Loads and positive administrative adjustments create customer value. Keep
-- those entries attributable even when a maintenance script bypasses the
-- application validation. Refunds and clawbacks are deliberately unchanged.

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_issuance_trace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_type = 'load'
     AND (NULLIF(BTRIM(NEW.reference_id), '') IS NULL
       OR NULLIF(BTRIM(NEW.description), '') IS NULL) THEN
    RAISE EXCEPTION 'OxSteed Credit loads require a funding reference and description'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.transaction_type = 'adjustment'
     AND COALESCE(NEW.metadata->>'direction', '') = 'credit'
     AND NULLIF(BTRIM(NEW.reference_id), '') IS NULL THEN
    RAISE EXCEPTION 'Positive OxSteed Credit adjustments require a funding reference'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_issuance_trace_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_issuance_trace_guard
  BEFORE INSERT OR UPDATE OF transaction_type, reference_id, description, metadata
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_issuance_trace();
