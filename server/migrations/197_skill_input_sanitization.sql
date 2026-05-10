-- VULN #21 FIX: Sanitize skill names and descriptions

ALTER TABLE skills_lookup ADD COLUMN IF NOT EXISTS sanitized_name VARCHAR(255);
ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS skill_notes_sanitized TEXT;

-- Create function to sanitize skill input
CREATE OR REPLACE FUNCTION sanitize_skill_input()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove HTML/JS from skill names
  NEW.sanitized_name := REGEXP_REPLACE(NEW.name, '<[^>]*>', '', 'g');
  NEW.sanitized_name := REGEXP_REPLACE(NEW.sanitized_name, 'javascript:', '', 'gi');
  NEW.sanitized_name := REGEXP_REPLACE(NEW.sanitized_name, 'on[a-z]+\s*=', '', 'gi');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sanitize_skill ON skills_lookup;
CREATE TRIGGER trigger_sanitize_skill
  BEFORE INSERT OR UPDATE ON skills_lookup
  FOR EACH ROW
  EXECUTE FUNCTION sanitize_skill_input();

-- When skills are selected, render from sanitized_name field only
-- Controller queries: SELECT sanitized_name FROM skills_lookup WHERE id IN (...)
