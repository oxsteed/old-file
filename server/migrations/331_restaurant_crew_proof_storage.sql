-- Migration 331: Private, verifiable storage metadata for Crew task proofs.

ALTER TABLE restaurant_crew_task_proofs
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS content_type VARCHAR(160),
  ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_crew_proofs_storage_key
  ON restaurant_crew_task_proofs (storage_key)
  WHERE storage_key IS NOT NULL;
