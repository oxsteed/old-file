-- 673_treasury_journal_idempotency.sql
--
-- Idempotency keys for treasury journal postings: a timed-out manual or
-- imported posting that is retried must not double-post. The key is
-- client-generated (or derived from the source event); the unique constraint
-- makes a conflicting retry observable so the API can return the existing
-- entry instead of inserting a duplicate.

ALTER TABLE treasury_journal_entries
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Backfill rows that predate the column with a deterministic unique key.
UPDATE treasury_journal_entries
  SET idempotency_key = 'migrated-' || id
  WHERE idempotency_key IS NULL;

ALTER TABLE treasury_journal_entries
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_journal_entries_idempotency_key
  ON treasury_journal_entries (idempotency_key);
