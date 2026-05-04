-- ═══════════════════════════════════════════════════════════════
-- Migration 167: Allow 'job' as appointment source + unique job_id guard
--
-- Context:
--   Migration 166 added appointments.source with CHECK (source IN ('user','ai_chat')).
--   The bid-acceptance flow (jobController.assignHelper) now auto-creates an
--   appointment row with source='job' so accepted jobs surface on the calendar.
--   This migration:
--     1. Widens the source CHECK to include 'job'.
--     2. Adds a partial unique index on job_id (WHERE job_id IS NOT NULL) so
--        concurrent retries of assignHelper cannot create duplicate rows.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Widen the source CHECK constraint to accept 'job'.
--    Drop-and-recreate is safe here because the column already has a default
--    of 'user' and no existing rows have source='job'.
DO $$
BEGIN
  ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_appointments_source;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_appointments_source'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_appointments_source
      CHECK (source IN ('user', 'ai_chat', 'job'));
  END IF;
END $$;

-- 2. Unique partial index: at most one appointment row per job.
--    Prevents duplicate calendar events if assignHelper is retried.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_job_unique
  ON appointments (job_id)
  WHERE job_id IS NOT NULL;

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 167
-- ═══════════════════════════════════════════════════════════════
