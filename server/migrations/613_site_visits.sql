-- Migration 613: site visitor history for the in-house visitor analytics.
--
-- Records one row per page view (sent by the client beacon), enriched
-- server-side with the visitor's country/city from Cloudflare geolocation
-- headers and a salted hash of the IP (raw IPs are never stored).
-- Old rows are pruned by the application retention job; the table is
-- append-only from the API's perspective.

CREATE TABLE IF NOT EXISTS site_visits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visited_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  path          TEXT NOT NULL,
  referrer      TEXT,
  ip_hash       TEXT NOT NULL,
  country_code  CHAR(2),
  country_name  TEXT,
  region_name   TEXT,
  city          TEXT,
  user_agent    TEXT,
  device_type   TEXT NOT NULL DEFAULT 'unknown',
  is_bot        BOOLEAN NOT NULL DEFAULT FALSE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_site_visits_visited_at
  ON site_visits (visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_country
  ON site_visits (country_code, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_path
  ON site_visits (path, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_user
  ON site_visits (user_id, visited_at DESC)
  WHERE user_id IS NOT NULL;
