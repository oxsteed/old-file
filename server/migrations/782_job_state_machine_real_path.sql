-- Review P1-135: `matched` / `negotiating` were never written by the app, yet
-- the transition guard required published -> matched -> accepted. Align the
-- guard with the real path (published -> accepted) and fold any stray legacy
-- rows back into `published` so every listing/bid branch sees them.
UPDATE jobs SET status = 'published', updated_at = NOW()
 WHERE status IN ('matched', 'negotiating');

CREATE OR REPLACE FUNCTION transition_job_state(
  p_job_id UUID,
  p_from_status VARCHAR,
  p_to_status VARCHAR,
  p_by_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_job RECORD;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_job.status != p_from_status THEN
    RETURN FALSE;
  END IF;
  CASE
    WHEN p_from_status = 'draft' AND p_to_status = 'published' THEN NULL;
    WHEN p_from_status IN ('published', 'matched', 'negotiating') AND p_to_status = 'accepted' THEN NULL;
    WHEN p_from_status IN ('matched', 'negotiating') AND p_to_status = 'published' THEN NULL;
    WHEN p_from_status = 'accepted' AND p_to_status = 'in_progress' THEN NULL;
    WHEN p_from_status = 'in_progress' AND p_to_status = 'completed' THEN NULL;
    WHEN p_to_status = 'cancelled' AND p_from_status NOT IN ('completed', 'closed') THEN NULL;
    WHEN p_from_status = 'completed' AND p_to_status = 'closed' THEN NULL;
    ELSE
      RAISE EXCEPTION 'Invalid job state transition: % -> %', p_from_status, p_to_status;
  END CASE;
  UPDATE jobs SET status = p_to_status, updated_at = NOW() WHERE id = p_job_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
