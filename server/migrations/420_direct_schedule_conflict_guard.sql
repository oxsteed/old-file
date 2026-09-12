-- Migration 420: race-safe Direct scheduling guard.
-- A helper/crew member has one concurrent dispatch slot. Unassigned work
-- shares a single provisional slot until an assignee is selected.

CREATE OR REPLACE FUNCTION prevent_direct_schedule_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.metadata->>'flow', 'direct') <> 'direct'
     OR NEW.status IN ('cancelled', 'closed', 'completed')
     OR NEW.scheduled_start_at IS NULL
     OR NEW.scheduled_end_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize checks for the same assignee, including the unassigned pool.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    COALESCE(NEW.assigned_to::text, 'direct-unassigned'), 0
  ));

  IF EXISTS (
    SELECT 1
      FROM quote_requests existing
     WHERE existing.id IS DISTINCT FROM NEW.id
       AND COALESCE(existing.metadata->>'flow', 'direct') = 'direct'
       AND existing.status NOT IN ('cancelled', 'closed', 'completed')
       AND existing.assigned_to IS NOT DISTINCT FROM NEW.assigned_to
       AND existing.scheduled_start_at IS NOT NULL
       AND existing.scheduled_end_at IS NOT NULL
       AND existing.scheduled_start_at < NEW.scheduled_end_at
       AND existing.scheduled_end_at > NEW.scheduled_start_at
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Direct schedule overlaps an existing booking'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS direct_schedule_overlap_guard ON quote_requests;

CREATE TRIGGER direct_schedule_overlap_guard
  BEFORE INSERT OR UPDATE OF scheduled_start_at, scheduled_end_at, assigned_to, status, metadata
  ON quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION prevent_direct_schedule_overlap();

