-- Phase 4: Bids table for job bidding system
-- Helpers bid on open jobs, posters accept/reject
-- NOTE: bids table already created in 001_initial_schema.sql with UUID types
-- This migration only adds extra columns/indexes if missing

-- Add columns that might be missing from 001
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Indexes (IF NOT EXISTS for safety)
CREATE INDEX IF NOT EXISTS idx_bids_job_id ON bids(job_id);
CREATE INDEX IF NOT EXISTS idx_bids_helper_id ON bids(helper_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);
CREATE INDEX IF NOT EXISTS idx_bids_job_status ON bids(job_id, status);
