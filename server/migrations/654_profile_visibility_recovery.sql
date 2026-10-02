-- Migration 654: operator recovery metadata for abandoned visibility batches.

ALTER TABLE bulk_visibility_idempotency
  ADD COLUMN IF NOT EXISTS request_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_bulk_visibility_idempotency_stale
  ON bulk_visibility_idempotency (claimed_at, created_at)
  WHERE status = 'processing';
