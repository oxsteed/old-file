-- Phase 4: Bids table for job bidding system
-- Helpers bid on open jobs, posters accept/reject

CREATE TABLE IF NOT EXISTS bids (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  helper_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  message TEXT,
  estimated_hours NUMERIC(5, 2),
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  -- pending, accepted, rejected, withdrawn, expired
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, helper_id)
);

-- Indexes
CREATE INDEX idx_bids_job_id ON bids(job_id);
CREATE INDEX idx_bids_helper_id ON bids(helper_id);
CREATE INDEX idx_bids_status ON bids(status);
CREATE INDEX idx_bids_job_status ON bids(job_id, status);
