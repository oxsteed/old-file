-- Migration 470: bind settlement creation to durable operator evidence.
--
-- A settlement idempotency key must replay the same snapshot request, not just
-- the same period. New rows retain the normalized creation reason and a
-- fingerprint covering every caller-controlled creation field. Legacy rows
-- remain valid with both evidence columns NULL and are handled compatibly by
-- the service when replayed.

ALTER TABLE oxsteed_credit_settlements
  ADD COLUMN IF NOT EXISTS creation_reason TEXT,
  ADD COLUMN IF NOT EXISTS creation_request_hash VARCHAR(64);

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_settlement_creation_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NULLIF(BTRIM(NEW.creation_reason), '') IS NULL
       OR NULLIF(BTRIM(NEW.creation_request_hash), '') IS NULL
       OR NEW.creation_request_hash !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'New OxSteed Credit settlements require creation evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.creation_reason IS DISTINCT FROM OLD.creation_reason
     OR NEW.creation_request_hash IS DISTINCT FROM OLD.creation_request_hash THEN
    RAISE EXCEPTION 'OxSteed Credit settlement creation evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_settlement_creation_evidence_guard ON oxsteed_credit_settlements;

CREATE TRIGGER oxsteed_credit_settlement_creation_evidence_guard
  BEFORE INSERT OR UPDATE OF creation_reason, creation_request_hash
  ON oxsteed_credit_settlements
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_settlement_creation_evidence();
