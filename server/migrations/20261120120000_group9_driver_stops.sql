-- Group 9 Slice C (item 462): multi-stop sequence for delivery jobs.
--
-- The schema was exactly one origin + one destination (migrations
-- 566/570); there was no stops table and no sequencing. delivery_job_stops
-- records the ordered stops of a job: pickup or dropoff, with address,
-- contact, instructions, and window per stop, plus per-stop status.
-- Pricing and ETA stay whole-job (no per-stop pricing); the stops are
-- the driver's working sequence, not a pricing input.
--
-- Backfill: every existing job gets its two legacy stops (origin pickup,
-- order 1; destination dropoff, order 2) with the job's pickup/delivery
-- windows. Stop status is derived from the job status so a delivered job
-- does not backfill as two pending stops: delivered/returned jobs get
-- both stops completed, picked_up/in_transit jobs get the pickup
-- completed, everything else pending. New jobs get their two stops from
-- the create path (localDeliveryController.create), in the same
-- transaction as the job row.
BEGIN;

CREATE TABLE IF NOT EXISTS delivery_job_stops (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  stop_order INTEGER NOT NULL CHECK (stop_order >= 1),
  stop_type VARCHAR(16) NOT NULL CHECK (stop_type IN ('pickup', 'dropoff')),
  address TEXT,
  city VARCHAR(120),
  state VARCHAR(120),
  country VARCHAR(3),
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  contact_name VARCHAR(160),
  contact_phone VARCHAR(40),
  instructions TEXT,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  completed_at TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Group 9 Slice C (item 463): once-only stamps for the window-warning
  -- sweep, one per warning kind, so a re-run never re-notifies the driver
  -- for the same stop and window.
  window_closing_notice_sent_at TIMESTAMPTZ,
  window_expired_notice_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_job_id, stop_order)
);
CREATE INDEX IF NOT EXISTS idx_delivery_job_stops_job ON delivery_job_stops(delivery_job_id, stop_order);

INSERT INTO delivery_job_stops
  (delivery_job_id, stop_order, stop_type, address, city, state, country, lat, lng,
   contact_name, contact_phone, instructions, window_start, window_end, status, completed_at)
SELECT
  j.id, 1, 'pickup',
  j.origin_address, j.origin_city, j.origin_state, j.origin_country, j.origin_lat, j.origin_lng,
  j.origin_contact_name, j.origin_contact_phone, j.origin_instructions,
  j.pickup_window_start, j.pickup_window_end,
  CASE WHEN j.status IN ('delivered', 'returned') THEN 'completed'
       WHEN j.status IN ('picked_up', 'in_transit', 'failed') THEN 'completed'
       ELSE 'pending' END,
  CASE WHEN j.status IN ('delivered', 'returned') THEN j.delivered_at
       WHEN j.status IN ('picked_up', 'in_transit', 'failed') THEN j.picked_up_at
       ELSE NULL END
FROM delivery_jobs j
WHERE NOT EXISTS (SELECT 1 FROM delivery_job_stops s WHERE s.delivery_job_id = j.id);

INSERT INTO delivery_job_stops
  (delivery_job_id, stop_order, stop_type, address, city, state, country, lat, lng,
   contact_name, contact_phone, instructions, window_start, window_end, status, completed_at)
SELECT
  j.id, 2, 'dropoff',
  j.destination_address, j.destination_city, j.destination_state, j.destination_country,
  j.destination_lat, j.destination_lng,
  j.destination_contact_name, j.destination_contact_phone, j.destination_instructions,
  j.delivery_window_start, j.delivery_window_end,
  CASE WHEN j.status IN ('delivered', 'returned') THEN 'completed' ELSE 'pending' END,
  CASE WHEN j.status IN ('delivered', 'returned') THEN j.delivered_at ELSE NULL END
FROM delivery_jobs j
WHERE NOT EXISTS (SELECT 1 FROM delivery_job_stops s WHERE s.delivery_job_id = j.id AND s.stop_order = 2);

COMMIT;
