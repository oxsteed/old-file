-- Migration 044: Add scheduling/preference columns to jobs table
-- Supports scheduled_time, recurrence, preferred helper, and private notes
-- OxSteed v2

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS scheduled_time      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS preferred_helper_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_helper_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS private_notes        TEXT;
