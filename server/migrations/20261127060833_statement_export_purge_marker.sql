-- S-F1 (D-636): purge marker for expired statement exports.
-- Migration 693's triggers make the export evidence rows (jobs, files,
-- frozen source rows) undeletable by design ("retained pending policy"),
-- so the purge removes only the rendered objects from private storage and
-- stamps this column instead of deleting rows. objects_purged_at is not
-- among the columns the 693 evidence guard protects, so stamping it is a
-- legal update. Additive and idempotent.
ALTER TABLE statement_export_jobs ADD COLUMN IF NOT EXISTS objects_purged_at TIMESTAMPTZ;
