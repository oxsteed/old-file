-- Migration 652: make bulk profile visibility idempotency a durable claim.
-- The request fingerprint prevents accidental reuse of a key for a different
-- batch. Processing claims can be reclaimed after a crashed request timeout.

BEGIN;

ALTER TABLE bulk_visibility_idempotency
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE bulk_visibility_idempotency
  DROP CONSTRAINT IF EXISTS bulk_visibility_idempotency_status_check;

ALTER TABLE bulk_visibility_idempotency
  ADD CONSTRAINT bulk_visibility_idempotency_status_check
  CHECK (status IN ('processing', 'completed'));

CREATE INDEX IF NOT EXISTS idx_bulk_visibility_idempotency_processing
  ON bulk_visibility_idempotency (status, claimed_at)
  WHERE status = 'processing';

COMMIT;
