-- Migration 713: incident investigation trail + consumer watermarks.
--
-- incident_notes: append-only analyst notes on incidents (investigation trail).
-- incident_watermarks: per-consumer high-water marks so background processors
--   can resume without reprocessing.

CREATE TABLE IF NOT EXISTS incident_notes (
  id BIGSERIAL PRIMARY KEY,
  incident_id BIGINT NOT NULL REFERENCES incident_log(id) ON DELETE CASCADE,
  author_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_notes_incident
  ON incident_notes (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_watermarks (
  consumer TEXT PRIMARY KEY,
  watermark TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
