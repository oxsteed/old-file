-- Visit-to-conversion attribution for Growth Center (Promote) performance.
-- Additive. A conversion row is written when a booking request, business
-- appointment or food order is created by a device that visited the owner's
-- profile through a tracked link in the previous 7 days (last touch). The
-- visitor key is the same consent-aware device id the visit used (persistent
-- only with analytics consent, else per-tab), hashed per owner; no user id,
-- contact detail or reference id is stored (dedupe uses a hash).
ALTER TABLE promotion_link_events DROP CONSTRAINT IF EXISTS promotion_link_events_event_type_check;
ALTER TABLE promotion_link_events ADD CONSTRAINT promotion_link_events_event_type_check
  CHECK (event_type IN ('share', 'visit', 'conversion'));

ALTER TABLE promotion_link_events
  ADD COLUMN IF NOT EXISTS conversion_type TEXT,
  ADD COLUMN IF NOT EXISTS attributed_visit_id BIGINT REFERENCES promotion_link_events(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE promotion_link_events ADD CONSTRAINT promotion_link_events_conversion_check CHECK (
    (event_type = 'conversion' AND conversion_type IN ('booking', 'appointment', 'order') AND dedupe_key IS NOT NULL)
    OR (event_type <> 'conversion' AND conversion_type IS NULL AND attributed_visit_id IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS promotion_link_events_visit_actor
  ON promotion_link_events(actor_key, occurred_at DESC) WHERE event_type = 'visit';
