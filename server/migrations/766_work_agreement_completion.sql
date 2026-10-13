-- Review P1 area 3: warranty windows run from completion, so record it.
ALTER TABLE work_agreements ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE work_agreements SET completed_at = updated_at
 WHERE status = 'completed' AND completed_at IS NULL;
