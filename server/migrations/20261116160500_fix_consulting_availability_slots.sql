-- Generate slots on the requested local calendar date. PostgreSQL has no
-- generate_series(time, time, interval) overload.
CREATE OR REPLACE FUNCTION get_consultant_available_slots(
  p_consultant_id UUID,
  p_target_date DATE,
  p_slot_duration_minutes INT DEFAULT 60
)
RETURNS TABLE (slot_start TIME, slot_end TIME, is_available BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  v_start_time TIME;
  v_end_time TIME;
  v_exception_available BOOLEAN;
  v_step INTERVAL;
BEGIN
  IF p_slot_duration_minutes IS NULL OR p_slot_duration_minutes NOT BETWEEN 1 AND 480 THEN
    RETURN;
  END IF;

  SELECT cse.start_time, cse.end_time, cse.is_available
    INTO v_start_time, v_end_time, v_exception_available
    FROM consultant_schedule_exceptions cse
   WHERE cse.consultant_id = p_consultant_id AND cse.exception_date = p_target_date
   ORDER BY cse.id
   LIMIT 1;

  IF FOUND THEN
    IF NOT v_exception_available THEN
      RETURN;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM consultant_blocked_dates
       WHERE consultant_id = p_consultant_id AND blocked_date = p_target_date
    ) THEN
      RETURN;
    END IF;
    SELECT ca.start_time, ca.end_time INTO v_start_time, v_end_time
      FROM consultant_availability ca
     WHERE ca.consultant_id = p_consultant_id
       AND ca.day_of_week = EXTRACT(DOW FROM p_target_date)::INT
       AND ca.is_active;
  END IF;

  v_step := make_interval(mins => p_slot_duration_minutes);
  RETURN QUERY
    SELECT slot.start_at::TIME, (slot.start_at + v_step)::TIME, TRUE
      FROM generate_series(
        p_target_date + v_start_time,
        p_target_date + v_end_time - v_step,
        v_step
      ) AS slot(start_at);
END;
$$;
