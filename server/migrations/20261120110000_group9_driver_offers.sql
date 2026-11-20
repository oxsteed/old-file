-- Group 9 Slice B (items 457, 460): driver offer deadline and decline capture.
--
-- 457: delivery_jobs gains an offer deadline (offer_expires_at, set when a
-- job is posted to the marketplace) plus the expiry marker
-- (offer_expired_at) and the once-only expiry-notice stamp
-- (offer_expiry_notice_sent_at). offer_deadline_hours records the
-- per-job configured window (1-168h; default 24, D-61). An expired offer
-- never deletes or cancels the job: it stays posted with the marker until
-- dispatch re-offers it. Live marketplace offers at migration time get a
-- fresh 24h window from now, not a retroactive expiry.
-- 460: delivery_job_declines records one decline per driver per job
-- (reason code + optional note); a second decline from the same driver
-- updates the first. Declining is advisory only: it never blocks the
-- driver from claiming this job later or any other job.
BEGIN;

ALTER TABLE delivery_jobs
  ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_expiry_notice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_deadline_hours INTEGER CHECK (offer_deadline_hours IS NULL OR (offer_deadline_hours >= 1 AND offer_deadline_hours <= 168));
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_offer_expiry ON delivery_jobs(offer_expires_at) WHERE status = 'posted' AND offer_expired_at IS NULL;

CREATE TABLE IF NOT EXISTS delivery_job_declines (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason_code VARCHAR(32) NOT NULL CHECK (reason_code IN ('too_far', 'schedule_conflict', 'capacity', 'vehicle', 'pay', 'other')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_job_id, driver_user_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_job_declines_job ON delivery_job_declines(delivery_job_id, created_at DESC);

UPDATE delivery_jobs
   SET offer_expires_at = NOW() + INTERVAL '24 hours',
       offer_deadline_hours = 24
 WHERE status = 'posted'
   AND dispatch_state = 'marketplace_posted'
   AND fulfillment_source = 'marketplace'
   AND offer_expires_at IS NULL;

COMMIT;
