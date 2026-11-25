-- D-429: export files expire 30 days after the job completes.
-- Adds expires_at to statement_export_jobs (nullable; NULL means "not yet
-- completed / no expiry assigned") and backfills existing completed jobs as
-- completed_at + 30 days. Additive and idempotent: re-running the migration
-- leaves already-stamped rows untouched. No state CHECK is widened: the
-- database keeps state 'complete' and the API reports 'expired' once
-- expires_at has passed (see statementExportJobService.effectiveState).
ALTER TABLE statement_export_jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
UPDATE statement_export_jobs
   SET expires_at = completed_at + interval '30 days'
 WHERE state = 'complete' AND completed_at IS NOT NULL AND expires_at IS NULL;
