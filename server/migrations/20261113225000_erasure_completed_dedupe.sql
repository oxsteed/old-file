-- Money flows W10: restaurant_erasure_requests has no dedupe
-- constraint on completed rows. The weekly retention sweep relies on
-- a NOT EXISTS (status = 'completed') check followed by a plain
-- INSERT, which races when two sweeps overlap (see W4): both pass
-- the check and insert duplicate 'completed' rows for the same
-- person, with divergent outcome JSON, confusing any later audit of
-- what was erased when.
--
-- A partial unique index on (business_id, user_id) WHERE status =
-- 'completed': one completed row per person per business, ever.
-- Non-completed rows (requested / approved / rejected) are
-- unaffected, so a person can still hold a live request while a
-- prior completed row exists. The sweep's auto-insert uses
-- ON CONFLICT ... DO NOTHING against this index, so the losing
-- sweep dedupes instead of erroring.
--
-- Fail-closed deploy note: if production already holds duplicate
-- completed rows for a person, this migration fails loudly and the
-- deploy stops; reconcile (keep the earliest completed row) before
-- retrying. Do not weaken the index to accommodate duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_erasure_requests_completed_dedupe
  ON restaurant_erasure_requests (business_id, user_id)
  WHERE status = 'completed';
