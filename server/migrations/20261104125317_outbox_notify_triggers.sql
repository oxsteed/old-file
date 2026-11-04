-- Outbox wakeups (cost audit 2026-11-04 item 7): notify listeners when a
-- row lands in an outbox table, so the screen-sync and activity-relay
-- pollers can wake on insert instead of polling every few seconds. The
-- intervals remain as slow safety sweeps.
--
-- pg_notify is transactional: the notification is delivered only when the
-- inserting transaction commits, so a listener never wakes for a row that
-- was rolled back. Listeners subscribe to the channel named in TG_ARGV[0]
-- and re-run the corresponding drain; the drains themselves stay fenced
-- and idempotent, so a duplicate wakeup is harmless.
CREATE OR REPLACE FUNCTION oxsteed_outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(TG_ARGV[0], '');
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS restaurant_screen_events_notify ON restaurant_screen_events;
CREATE TRIGGER restaurant_screen_events_notify AFTER INSERT ON restaurant_screen_events
  FOR EACH ROW EXECUTE FUNCTION oxsteed_outbox_notify('oxsteed_screen_events');
DROP TRIGGER IF EXISTS activity_outbox_notify ON activity_outbox;
CREATE TRIGGER activity_outbox_notify AFTER INSERT ON activity_outbox
  FOR EACH ROW EXECUTE FUNCTION oxsteed_outbox_notify('oxsteed_activity_outbox');
