-- Unique constraints required for bulk-upsert ON CONFLICT clauses
-- home_tasks: one row per user per (title, section)
ALTER TABLE home_tasks
  ADD CONSTRAINT IF NOT EXISTS uq_home_tasks_user_title_section
  UNIQUE (user_id, title, section);

-- goals: one row per user per title
ALTER TABLE goals
  ADD CONSTRAINT IF NOT EXISTS uq_goals_user_title
  UNIQUE (user_id, title);
