-- Saved "Discover" search alerts (digest when public matches change)

CREATE TABLE IF NOT EXISTS discover_search_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  radius_miles INTEGER NOT NULL DEFAULT 25 CHECK (radius_miles >= 1 AND radius_miles <= 200),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  fingerprint VARCHAR(64) NOT NULL,
  last_signature TEXT,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discover_alerts_user_fp
  ON discover_search_alerts (user_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_discover_alerts_user ON discover_search_alerts (user_id);
