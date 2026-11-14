-- Cost audit 2026-11-13 item 15: a program with a NULL commission rate was
-- re-selected by the daily affiliate batch forever (skipped, deduped
-- incident only) because nothing marked it resolved. This timestamp is the
-- durable skip marker: the batch sets it when it skips a NULL-rate program
-- and excludes flagged programs from the selection. The exclusion also
-- requires commission_rate IS NULL, so setting a rate later re-enables the
-- program without any marker cleanup.
ALTER TABLE affiliate_programs ADD COLUMN IF NOT EXISTS commission_rate_missing_at TIMESTAMPTZ;
