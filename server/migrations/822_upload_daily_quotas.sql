-- Migration 822: per-user/per-day upload storage quota ledger
-- Review P3-6-F13: no upload surface had a per-user/per-day byte quota
-- (generic /api/upload allowed 500 req/15min/user x 10MB). This table backs
-- the atomic check-and-reserve in middleware/uploadQuota.js. One row per
-- quota key per UTC day; old rows are harmless and may be pruned by a
-- scheduled cleanup (no TTL enforced here to keep the hot path simple).

CREATE TABLE IF NOT EXISTS upload_daily_quotas (
  user_key  TEXT NOT NULL,
  day       DATE NOT NULL,
  bytes_used BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_key, day)
);
