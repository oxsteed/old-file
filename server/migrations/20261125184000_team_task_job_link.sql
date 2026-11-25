-- Groups 5-6 item 267 (G5-16): link team tasks to an OxSteed job so a
-- manager can allocate work for a specific job. Nullable: existing tasks
-- stay unlinked. Additive and idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_team_tasks' AND column_name = 'job_id') THEN
    ALTER TABLE business_team_tasks
      ADD COLUMN job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS business_team_tasks_job_id_idx
  ON business_team_tasks (business_id, job_id);
