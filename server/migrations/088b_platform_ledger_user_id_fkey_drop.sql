-- Same class of issue as migration 052 for platform_ledger.job_id:
-- user_id REFERENCES users(id) ON DELETE SET NULL triggers an UPDATE that is
-- swallowed by ledger_no_update (DO INSTEAD NOTHING), blocking user deletion.
-- Keep immutable ledger rows; retain historical user_id UUID without FK enforcement.

ALTER TABLE platform_ledger
  DROP CONSTRAINT IF EXISTS platform_ledger_user_id_fkey;
