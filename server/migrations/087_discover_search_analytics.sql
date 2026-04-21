-- Discover search analytics (aggregated intent, not raw PII)

CREATE TABLE IF NOT EXISTS discover_search_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  query_normalized TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  radius_miles INTEGER,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  ip_hash VARCHAR(64),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_discover_log_created ON discover_search_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discover_log_query ON discover_search_log (lower(query_normalized));
CREATE INDEX IF NOT EXISTS idx_discover_log_zero ON discover_search_log ((result_count = 0), created_at DESC);
