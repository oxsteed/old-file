-- Phase 7: Business Skills Integration
-- Create table to track skills required by each business

CREATE TABLE IF NOT EXISTS business_skills (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills_lookup(id) ON DELETE RESTRICT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  min_years_experience SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, skill_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_business_skills_business_id ON business_skills(business_id);
CREATE INDEX IF NOT EXISTS idx_business_skills_skill_id ON business_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_business_skills_required ON business_skills(is_required) WHERE is_required = true;

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_business_skills_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_business_skills_timestamp_trigger ON business_skills;
CREATE TRIGGER update_business_skills_timestamp_trigger
BEFORE UPDATE ON business_skills
FOR EACH ROW
EXECUTE FUNCTION update_business_skills_timestamp();
