-- VULN #14 FIX: Prevent double-booking same time slot

-- Add constraint to prevent overlapping appointments
CREATE OR REPLACE FUNCTION check_appointment_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM appointments
    WHERE helper_id = NEW.helper_id
      AND id != NEW.id
      AND status NOT IN ('cancelled', 'declined')
      AND (
        -- Check for time overlap
        (NEW.scheduled_start_at < ends_at AND NEW.ends_at > scheduled_start_at)
      )
  ) THEN
    RAISE EXCEPTION 'Helper unavailable at this time - slot already booked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_overlap ON appointments;
CREATE TRIGGER trigger_prevent_overlap
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION check_appointment_overlap();

-- Use pessimistic locking when checking availability
-- Controller should call: SELECT * FROM helper_availability WHERE ... FOR UPDATE
