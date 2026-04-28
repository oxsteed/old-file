-- Extend jobs table to support required skills
-- Denormalize both full skill objects (JSONB) and IDs (INT[]) for efficient filtering

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]' CHECK (jsonb_typeof(required_skills) = 'array'),
  ADD COLUMN IF NOT EXISTS skill_ids INT[] DEFAULT '{}';

-- GIN index for efficient array containment queries (WHERE skill_ids @> '{123,456}')
CREATE INDEX IF NOT EXISTS idx_jobs_skill_ids ON jobs USING GIN(skill_ids);

-- Comment for clarity
COMMENT ON COLUMN jobs.required_skills IS 'Array of {id, name, min_years_experience, is_required} objects';
COMMENT ON COLUMN jobs.skill_ids IS 'Array of skill_lookup.id values for efficient filtering; mirrors required_skills[].id';
