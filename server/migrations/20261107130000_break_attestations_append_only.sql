-- Item 43 (design review): break attestations are append-only.
--
-- The original Phase 7 table carried UNIQUE (time_entry_id) and the
-- service upserted ON CONFLICT DO UPDATE, so a corrected statement
-- silently rewrote the first one: the original statement was lost.
-- Attestations are evidence; a later statement must never destroy an
-- earlier one. Drop the unique constraint (defensive lookup by the
-- real constraint name, so this also runs on databases where the
-- constraint was named differently) and add a covering index for the
-- latest-per-entry lookups the readers use. No version column: id is
-- a BIGSERIAL (monotonic insertion order) and attested_at ties break
-- on id DESC, which deterministically identifies the latest version.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'restaurant_break_attestations'
     AND c.contype = 'u'
     AND pg_get_constraintdef(c.oid) ILIKE '%time_entry_id%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE restaurant_break_attestations DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_break_attestations_latest
  ON restaurant_break_attestations (time_entry_id, attested_at DESC, id DESC);
