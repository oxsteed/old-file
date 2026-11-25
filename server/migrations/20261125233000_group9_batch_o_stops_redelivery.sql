-- Group 9 partials Wave 2 Batch O (items 462/464/471/475, G9-A13/G9-A6/G9-A11):
-- a driver note field on stops, and a redelivery-attempt request table.
--
-- driver_note: the assigned driver can leave a route note on a stop
-- (D-543). Free text, participant-visible, never a pricing or proof
-- input. Empty clears it.
--
-- delivery_redelivery_requests: a failed drop-off gets its own retry
-- path (D-548). The driver requests a redelivery with a new delivery
-- window; ops or the shipper approves or rejects it. This is NOT the
-- general reschedule path: assertReschedulable still 409s rescheduling
-- after pickup, and this table carries no pickup window at all. One
-- pending request per job (partial unique index); approval applies the
-- new window and restores a failed job to in_transit in the same
-- transaction as the request review.
ALTER TABLE delivery_job_stops
  ADD COLUMN IF NOT EXISTS driver_note TEXT,
  ADD COLUMN IF NOT EXISTS driver_note_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS driver_note_updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS delivery_redelivery_requests (
  id BIGSERIAL PRIMARY KEY,
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_window_start TIMESTAMPTZ NOT NULL,
  delivery_window_end TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (delivery_window_end > delivery_window_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_redelivery_pending
  ON delivery_redelivery_requests (delivery_job_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_delivery_redelivery_job
  ON delivery_redelivery_requests (delivery_job_id, created_at DESC);
