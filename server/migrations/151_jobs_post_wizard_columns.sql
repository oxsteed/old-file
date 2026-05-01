-- Migration 151: Ensure jobs columns used by POST /api/jobs (createJob) exist.
-- Fresh installs that only ran 001_initial_schema.sql have a minimal jobs table;
-- later wizard columns live in 036, 044, 080, etc. This migration is idempotent
-- so createJob never hits "column does not exist" (500) on partial migration order.


ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS budget_type VARCHAR(20) DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS urgency VARCHAR(20) DEFAULT 'flexible',
  ADD COLUMN IF NOT EXISTS site_access VARCHAR(30) DEFAULT 'easy',
  ADD COLUMN IF NOT EXISTS job_type_label VARCHAR(30) DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS location_approx_lat NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS location_approx_lng NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS requirements JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence VARCHAR(50),
  ADD COLUMN IF NOT EXISTS preferred_helper_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_helper_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS private_notes TEXT,
  ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS skill_ids INT[] DEFAULT '{}'::integer[];

-- media_urls: 001 uses TEXT[] NOT NULL DEFAULT '{}'
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS media_urls TEXT[] NOT NULL DEFAULT '{}'::text[];

-- location_point may exist as GEOGRAPHY(POINT,4326) in 001; 036 also adds it — keep one form
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'location_point'
  ) THEN
    ALTER TABLE jobs ADD COLUMN location_point GEOGRAPHY(Point, 4326);
  END IF;
END $$;
