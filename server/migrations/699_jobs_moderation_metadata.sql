-- Moderation flags are stored on the job record so the admin queue can
-- distinguish an internal flag from user-submitted content reports.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_jobs_admin_flagged
  ON jobs ((metadata->>'admin_flagged'))
  WHERE metadata->>'admin_flagged' = 'true';
