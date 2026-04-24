-- Additional constraints and triggers for data integrity

BEGIN;

-- Clean up existing data to satisfy constraints
-- Set helper_response_deadline to NULL for sessions not in waiting_for_helper state
UPDATE guest_profile_chat_inbound
SET helper_response_deadline = NULL
WHERE session_status IS DISTINCT FROM 'waiting_for_helper'
  AND helper_response_deadline IS NOT NULL;

-- Prevent orphaned AI summaries (only set when transitioning to helper)
ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT check_ai_summary_only_on_takeover
  CHECK (
    (session_status IN ('helper_takeover_requested', 'helper_assigned') AND ai_summary IS NOT NULL)
    OR (session_status NOT IN ('helper_takeover_requested', 'helper_assigned') AND ai_summary IS NULL)
  );

-- Ensure helper_id is set when helper_assigned
ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT check_helper_assigned_requires_id
  CHECK (
    (session_status = 'helper_assigned' AND helper_id IS NOT NULL)
    OR (session_status != 'helper_assigned')
  );

-- Ensure deadlines only set during waiting period
ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT check_deadline_during_waiting
  CHECK (
    (session_status = 'waiting_for_helper' AND helper_response_deadline IS NOT NULL)
    OR (session_status IS DISTINCT FROM 'waiting_for_helper' AND helper_response_deadline IS NULL)
  );

-- Create trigger to update last_activity_at on any state change
CREATE OR REPLACE FUNCTION update_guest_chat_activity()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_activity_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_guest_chat_activity
  BEFORE UPDATE ON guest_profile_chat_inbound
  FOR EACH ROW
  EXECUTE FUNCTION update_guest_chat_activity();

-- Create trigger to log all state transitions
CREATE OR REPLACE FUNCTION log_guest_chat_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.session_status IS DISTINCT FROM NEW.session_status THEN
    INSERT INTO chat_monitoring_log (
      session_id, event_type, helper_id, metadata
    ) VALUES (
      NEW.id,
      'status_changed_' || NEW.session_status,
      NEW.helper_id,
      jsonb_build_object(
        'from_status', OLD.session_status,
        'to_status', NEW.session_status,
        'transition_time_ms', EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - OLD.last_activity_at)) * 1000
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_guest_chat_transition
  AFTER UPDATE ON guest_profile_chat_inbound
  FOR EACH ROW
  EXECUTE FUNCTION log_guest_chat_transition();

COMMIT;
