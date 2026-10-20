-- Stop new precise-coordinate logging in application code. Keep the old
-- columns until a separately reviewed backfill/retention run completes.
ALTER TABLE discover_search_log ADD COLUMN IF NOT EXISTS postal_ref INTEGER;
CREATE INDEX IF NOT EXISTS discover_search_log_retention ON discover_search_log(created_at);
