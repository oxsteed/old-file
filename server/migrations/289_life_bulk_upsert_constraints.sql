-- Unique constraints required for bulk-upsert ON CONFLICT clauses
-- home_tasks: one row per user per (title, section)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_home_tasks_user_title_section'
  ) THEN
    ALTER TABLE home_tasks
      ADD CONSTRAINT uq_home_tasks_user_title_section
      UNIQUE (user_id, title, section);
  END IF;
END $$;

-- goals: one row per user per title
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_goals_user_title'
  ) THEN
    ALTER TABLE goals
      ADD CONSTRAINT uq_goals_user_title
      UNIQUE (user_id, title);
  END IF;
END $$;
