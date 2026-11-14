-- Delivery item description and item photos (2026-11-13, items 8).
-- item_description is what the item is, stored on the job so the assigned
-- driver can see it. delivery_job_item_photos mirrors
-- delivery_proof_uploads: customer-uploaded photos of the item, taken after
-- posting and before pickup. They are not proof records and are never
-- consumed by proof verification.
BEGIN;

ALTER TABLE delivery_jobs
  ADD COLUMN IF NOT EXISTS item_description TEXT;

CREATE TABLE IF NOT EXISTS delivery_job_item_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  object_key TEXT UNIQUE NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 CHAR(64) NOT NULL,
  scan_status TEXT NOT NULL CHECK (scan_status = 'clean'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_job_item_photos_job
  ON delivery_job_item_photos(delivery_job_id, created_at DESC);

COMMIT;
