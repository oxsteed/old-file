-- ATTACK #8 FIX: Job State Machine Race Condition Prevention
-- Ensures job state transitions are atomic and prevent invalid state combinations

-- Add constraint to prevent completing a cancelled job
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_job_not_completed_after_cancel' AND table_name = 'jobs'
  ) THEN
    ALTER TABLE jobs ADD CONSTRAINT chk_job_not_completed_after_cancel
      CHECK (NOT (status = 'completed' AND cancelled_at IS NOT NULL));
  END IF;
END $$;

-- Add constraint to prevent cancelling a completed job
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_job_not_cancelled_after_complete' AND table_name = 'jobs'
  ) THEN
    ALTER TABLE jobs ADD CONSTRAINT chk_job_not_cancelled_after_complete
      CHECK (NOT (status = 'cancelled' AND completed_at IS NOT NULL));
  END IF;
END $$;

-- Create function to safely transition job state
-- This ensures only valid state transitions occur and uses locking to prevent races
CREATE OR REPLACE FUNCTION transition_job_state(
  p_job_id UUID,
  p_from_status VARCHAR,
  p_to_status VARCHAR,
  p_by_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_job jobs%ROWTYPE;
BEGIN
  -- Lock the job row to prevent concurrent transitions
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Verify current state matches expected from_status
  IF v_job.status != p_from_status THEN
    RETURN FALSE;
  END IF;
  -- Validate transition is allowed
  CASE
    WHEN p_from_status = 'draft' AND p_to_status = 'published' THEN NULL;
    WHEN p_from_status = 'published' AND p_to_status = 'matched' THEN NULL;
    WHEN p_from_status = 'matched' AND p_to_status = 'accepted' THEN NULL;
    WHEN p_from_status = 'accepted' AND p_to_status = 'in_progress' THEN NULL;
    WHEN p_from_status = 'in_progress' AND p_to_status = 'completed' THEN NULL;
    WHEN p_to_status = 'cancelled' AND p_from_status NOT IN ('completed', 'closed') THEN NULL;
    WHEN p_from_status = 'completed' AND p_to_status = 'closed' THEN NULL;
    ELSE
      RAISE EXCEPTION 'Invalid job state transition: % -> %', p_from_status, p_to_status;
  END CASE;
  -- Perform the transition
  UPDATE jobs SET status = p_to_status, updated_at = NOW() WHERE id = p_job_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION transition_job_state IS 'Atomically transitions job state with full locking and validation to prevent race conditions';
