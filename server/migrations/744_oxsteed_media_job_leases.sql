-- Media processing jobs need a lease so a crashed worker cannot strand a video
-- in `running`, and a late worker cannot commit after another worker reclaimed it.
ALTER TABLE media_processing_jobs
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

UPDATE media_processing_jobs
   SET next_attempt_at = COALESCE(next_attempt_at, NOW()),
       max_attempts = COALESCE(NULLIF(max_attempts, 0), 5)
 WHERE next_attempt_at IS NULL OR max_attempts IS NULL OR max_attempts = 0;

CREATE INDEX IF NOT EXISTS idx_media_processing_jobs_claim
  ON media_processing_jobs(status, next_attempt_at, lease_expires_at, created_at);
