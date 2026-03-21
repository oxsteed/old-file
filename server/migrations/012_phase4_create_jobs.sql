-- Phase 4: Jobs table for Tier 3 Protected Payments
-- Supports job posting, bidding, assignment, and completion workflow

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  poster_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  subcategory VARCHAR(100),
  budget_min NUMERIC(10, 2),
  budget_max NUMERIC(10, 2),
  final_price NUMERIC(10, 2),
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  -- open, bidding, assigned, in_progress, completed, cancelled, disputed
  priority VARCHAR(20) DEFAULT 'normal',
  -- normal, urgent, emergency
  location_address TEXT,
  location_city VARCHAR(100),
  location_state VARCHAR(50),
  location_zip VARCHAR(20),
  location_lat NUMERIC(10, 7),
  location_lng NUMERIC(10, 7),
  is_remote BOOLEAN DEFAULT false,
  scheduled_date TIMESTAMPTZ,
  scheduled_time_start TIME,
  scheduled_time_end TIME,
  estimated_duration_hours NUMERIC(5, 2),
  actual_duration_hours NUMERIC(5, 2),
  requirements JSONB DEFAULT '[]',
  images JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  assigned_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  poster_confirmed BOOLEAN DEFAULT false,
  helper_confirmed BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_jobs_poster_id ON jobs(poster_id);
CREATE INDEX idx_jobs_helper_id ON jobs(helper_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_category ON jobs(category);
CREATE INDEX idx_jobs_location ON jobs(location_city, location_state);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_scheduled_date ON jobs(scheduled_date);
CREATE INDEX idx_jobs_status_category ON jobs(status, category);
