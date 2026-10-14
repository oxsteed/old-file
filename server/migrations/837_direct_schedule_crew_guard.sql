-- Migration 837: race-safe Direct scheduling guard covers the full crew.
-- Review P1-4-F02 / P1-4-F08: the migration 420 trigger serialized and
-- conflict-checked only assigned_to (the lead). Multi-crew bookings persist
-- the whole crew in quote_request_crew (migration 784), so crew members 2..N
-- could be double-booked through the schedule/change/admin-PATCH paths that
-- bypass the app-level per-member locks. The guard set is now the lead
-- assignee plus every crew row already persisted for the request, and the
-- advisory serialization lock is taken per crew member.
--
-- Unassigned work keeps the old semantics: unassigned requests share a single
-- provisional slot until an assignee (or crew) is selected.

CREATE OR REPLACE FUNCTION prevent_direct_schedule_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  guard_ids uuid[];
  gid uuid;
BEGIN
  IF COALESCE(NEW.metadata->>'flow', 'direct') <> 'direct'
     OR NEW.status IN ('cancelled', 'closed', 'completed')
     OR NEW.scheduled_start_at IS NULL
     OR NEW.scheduled_end_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Guard set: lead assignee plus crew members already persisted in the
  -- junction. On INSERT from the instant-book path the junction lands in the
  -- same transaction after this row; that path takes per-member advisory
  -- locks and re-checks in the app layer, and the trigger still guards the
  -- lead here. On UPDATE (admin PATCH / reschedule) the junction is already
  -- present, so the full crew is guarded.
  SELECT array_agg(DISTINCT uid) INTO guard_ids
    FROM (
      SELECT NEW.assigned_to AS uid WHERE NEW.assigned_to IS NOT NULL
      UNION
      SELECT c.user_id FROM quote_request_crew c WHERE c.quote_request_id = NEW.id
    ) g;

  -- Serialize checks per crew member, including the unassigned pool.
  IF guard_ids IS NOT NULL THEN
    FOREACH gid IN ARRAY guard_ids LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(gid::text, 0));
    END LOOP;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('direct-unassigned', 0));
  END IF;

  IF EXISTS (
    SELECT 1
      FROM quote_requests existing
     WHERE existing.id IS DISTINCT FROM NEW.id
       AND COALESCE(existing.metadata->>'flow', 'direct') = 'direct'
       AND existing.status NOT IN ('cancelled', 'closed', 'completed')
       AND existing.scheduled_start_at IS NOT NULL
       AND existing.scheduled_end_at IS NOT NULL
       AND existing.scheduled_start_at < NEW.scheduled_end_at
       AND existing.scheduled_end_at > NEW.scheduled_start_at
       AND (
         -- Guarded crew member (lead or junction) on either side.
         (guard_ids IS NOT NULL
          AND (existing.assigned_to = ANY(guard_ids)
               OR EXISTS (SELECT 1 FROM quote_request_crew ec
                           WHERE ec.quote_request_id = existing.id
                             AND ec.user_id = ANY(guard_ids))))
         -- Unassigned pool: unassigned requests still share one slot.
         OR (guard_ids IS NULL
             AND existing.assigned_to IS NULL
             AND NOT EXISTS (SELECT 1 FROM quote_request_crew ec
                              WHERE ec.quote_request_id = existing.id))
       )
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
