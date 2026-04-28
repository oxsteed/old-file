-- Migration 042: Planned Needs — preferred helper fields
-- Adds: preferred_helper_id, preferred_helper_status, helper_notified_at
-- These support the 72-hour preferred-helper hold before job broadcasts to all.

ALTER TABLE planned_needs
  ADD COLUMN IF NOT EXISTS preferred_helper_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_helper_status VARCHAR(20) DEFAULT NULL,
  -- NULL = no preferred helper | 'pending' | 'accepted' | 'declined' | 'expired'
  ADD COLUMN IF NOT EXISTS helper_notified_at      TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_planned_needs_pref_hold
  ON planned_needs(preferred_helper_status, helper_notified_at)
  WHERE preferred_helper_status = 'pending';
