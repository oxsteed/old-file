-- Migration 779 (review P3-914): replaced uploads were never deleted. Files
-- that are replaced are queued here and removed by the storage cleanup worker
-- after a grace period (STORAGE_CLEANUP_ENABLED=true turns deletion on).
CREATE TABLE IF NOT EXISTS storage_deletion_queue (
  id BIGSERIAL PRIMARY KEY,
  storage_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  not_before TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT storage_deletion_queue_key_unique UNIQUE (storage_key)
);

CREATE INDEX IF NOT EXISTS idx_storage_deletion_queue_due
  ON storage_deletion_queue (not_before)
  WHERE deleted_at IS NULL;
