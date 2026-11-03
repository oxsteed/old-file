-- Customer 360 upgrade 12: one precomputed summary row per customer, kept
-- current from the event log and a TTL sweep, with explicit staleness.
-- Sized for ~6M customers: a narrow row plus one JSONB document (~1-2 KB),
-- fillfactor 80 so recomputes are HOT updates, and partial indexes so the
-- dirty queue and stale sweep never scan the whole table.
CREATE TABLE IF NOT EXISTS customer360_summaries (
  customer_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  model_version   VARCHAR(40) NOT NULL,
  summary         JSONB NOT NULL CHECK (jsonb_typeof(summary) = 'object' AND pg_column_size(summary) <= 16384),
  event_watermark BIGINT NOT NULL DEFAULT 0,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  compute_ms      INTEGER NOT NULL DEFAULT 0 CHECK (compute_ms >= 0),
  failed_sources  TEXT[] NOT NULL DEFAULT '{}',
  -- Set when events arrive after the last compute; cleared by the compute
  -- only if no newer event marked it meanwhile.
  dirty_since     TIMESTAMPTZ,
  claimed_until   TIMESTAMPTZ
) WITH (fillfactor = 80);
CREATE INDEX IF NOT EXISTS idx_customer360_summaries_dirty
  ON customer360_summaries (dirty_since) WHERE dirty_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer360_summaries_computed
  ON customer360_summaries (computed_at);
