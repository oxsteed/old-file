-- Migration 273: Explicit support-agent hiring profiles for businesses
-- Lets businesses opt in to public support-agent applications instead of
-- inferring hiring intent from support activity alone.

CREATE TABLE IF NOT EXISTS support_agent_hiring_profiles (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  is_accepting_applications BOOLEAN NOT NULL DEFAULT FALSE,
  hiring_title VARCHAR(200),
  hiring_description TEXT,
  desired_languages TEXT[],
  desired_shift_coverage TEXT,
  remote_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  compensation_summary TEXT,
  response_time_expectation VARCHAR(200),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX IF NOT EXISTS idx_support_agent_hiring_profiles_accepting
  ON support_agent_hiring_profiles (is_accepting_applications);
