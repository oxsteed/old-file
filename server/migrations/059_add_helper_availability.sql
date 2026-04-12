-- Migration 059: Add helper availability toggle for live chat
-- Allows helpers to mark themselves as available for direct real-time messaging

ALTER TABLE helpers
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_since TIMESTAMPTZ;

-- Index for fast filtering of available helpers on browse page
CREATE INDEX IF NOT EXISTS idx_helpers_is_available
  ON helpers (is_available)
  WHERE is_available = true;
