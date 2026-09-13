-- Migration 475: reject blank idempotency keys below the API.
--
-- Idempotency is a safety boundary for a stored-value rail. NULL is retained
-- for legacy optional fields, but an explicitly supplied key must contain
-- meaningful non-whitespace data.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_transactions_idempotency_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_transactions
      ADD CONSTRAINT oxsteed_credit_transactions_idempotency_key_nonblank
      CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_holds_idempotency_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_holds
      ADD CONSTRAINT oxsteed_credit_holds_idempotency_key_nonblank
      CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_holds_capture_idempotency_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_holds
      ADD CONSTRAINT oxsteed_credit_holds_capture_idempotency_key_nonblank
      CHECK (capture_idempotency_key IS NULL OR NULLIF(BTRIM(capture_idempotency_key), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_settlements_idempotency_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_settlements
      ADD CONSTRAINT oxsteed_credit_settlements_idempotency_key_nonblank
      CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_agreements_creation_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_partner_agreements
      ADD CONSTRAINT oxsteed_credit_agreements_creation_key_nonblank
      CHECK (creation_idempotency_key IS NULL OR NULLIF(BTRIM(creation_idempotency_key), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_disputes_idempotency_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_disputes
      ADD CONSTRAINT oxsteed_credit_disputes_idempotency_key_nonblank
      CHECK (idempotency_key IS NULL OR NULLIF(BTRIM(idempotency_key), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_entitlement_bulk_request_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_entitlement_bulk_requests
      ADD CONSTRAINT oxsteed_credit_entitlement_bulk_request_key_nonblank
      CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'oxsteed_credit_entitlement_request_key_nonblank'
  ) THEN
    ALTER TABLE oxsteed_credit_entitlement_requests
      ADD CONSTRAINT oxsteed_credit_entitlement_request_key_nonblank
      CHECK (NULLIF(BTRIM(idempotency_key), '') IS NOT NULL);
  END IF;
END;
$$;
