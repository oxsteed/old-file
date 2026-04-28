-- Add section column to home_tasks to support Personal Care and Car Care tabs
ALTER TABLE home_tasks ADD COLUMN IF NOT EXISTS section VARCHAR(50) NOT NULL DEFAULT 'home';
CREATE INDEX IF NOT EXISTS home_tasks_user_section_idx ON home_tasks (user_id, section);
