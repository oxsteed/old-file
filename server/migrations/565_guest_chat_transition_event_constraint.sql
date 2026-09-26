-- Migration 565: keep guest chat transition telemetry compatible with its
-- event-type constraint. Migration 099 used dynamic event names such as
-- status_changed_ai_fallback_pending, but migration 098 only allows a fixed
-- event vocabulary. Use one stable event type and preserve the transition in
-- metadata instead.

BEGIN;

ALTER TABLE chat_monitoring_log
  DROP CONSTRAINT IF EXISTS chat_monitoring_log_event_type_check;

ALTER TABLE chat_monitoring_log
  ADD CONSTRAINT chat_monitoring_log_event_type_check
  CHECK (event_type IN (
    'session_created',
    'helper_invited',
    'helper_accepted',
    'ai_fallback_triggered',
    'ai_fallback_triggered_timeout',
    'ai_fallback_triggered_no_helpers',
    'helper_claimed_from_ai',
    'helper_assigned',
    'session_resolved',
    'guest_abandoned',
    'transition_queue_drained',
    'error_occurred',
    'status_changed'
  ));

CREATE OR REPLACE FUNCTION log_guest_chat_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.session_status IS DISTINCT FROM NEW.session_status THEN
    INSERT INTO chat_monitoring_log (
      session_id, event_type, helper_id, metadata
    ) VALUES (
      NEW.id,
      'status_changed',
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

COMMIT;
