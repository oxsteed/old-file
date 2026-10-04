-- Migration 672: Saved searches v2 — search types, free-form query/filters, alert dedupe.
--
-- The v1 table (migration 288) only modeled job alerts with flat columns
-- (keyword, category, city, state, budgets). This extends it so searches can
-- be saved from the helpers, jobs, tools, and food discovery surfaces:
--   search_type  'job' | 'helper' | 'tool' | 'food'  (legacy rows default to 'job')
--   query        free-text query, backfilled from the legacy keyword column
--   filters     JSONB snapshot of the surface's active filters
-- A new saved_search_alerts table dedupes fan-out: one alert per saved
-- search per item, enforced by a UNIQUE constraint with INSERT ... ON
-- CONFLICT DO NOTHING.
--
-- Additive only. All statements are idempotent (IF NOT EXISTS / NOT EXISTS
-- guards) so a retried run is safe.

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS search_type TEXT NOT NULL DEFAULT 'job';

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS query TEXT;

ALTER TABLE saved_searches
  ADD COLUMN IF NOT EXISTS filters JSONB NOT NULL DEFAULT '{}';

-- Backfill the new query column from the legacy keyword column.
UPDATE saved_searches
SET query = keyword
WHERE query IS NULL AND keyword IS NOT NULL;

-- Constrain search_type to the known discovery surfaces.
ALTER TABLE saved_searches
  DROP CONSTRAINT IF EXISTS chk_saved_searches_search_type;

ALTER TABLE saved_searches
  ADD CONSTRAINT chk_saved_searches_search_type
  CHECK (search_type IN ('job', 'helper', 'tool', 'food'));

CREATE INDEX IF NOT EXISTS idx_saved_searches_search_type
  ON saved_searches(search_type)
  WHERE notify = true;

-- ── Alert dedupe ledger ──────────────────────────────────────────────────────
-- One row per (saved_search, item_type, item_id). The fan-out worker inserts
-- here first with ON CONFLICT DO NOTHING and only sends a notification when
-- the insert actually lands, so a saver never gets the same alert twice even
-- if the hook fires again (retries, re-listing, re-runs).

CREATE TABLE IF NOT EXISTS saved_search_alerts (
  id              SERIAL PRIMARY KEY,
  saved_search_id UUID NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  item_type       TEXT NOT NULL,
  item_id         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_saved_search_alert UNIQUE (saved_search_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_search_alerts_search
  ON saved_search_alerts(saved_search_id);
