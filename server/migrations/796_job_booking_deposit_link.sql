-- Migration 796: link auto-posted jobs to their source booking's deposit (audit P3-8-F13).
--
-- autoPostExpiredBooking converts an expired booking_request into a public
-- job. When the booking carried a paid deposit, the deposit is settled
-- (refunded) by bookingDepositService, but the posted job kept no record of
-- it: the customer could later be charged the full job price with no trace
-- that a deposit had already been paid on the original request. These
-- columns carry the linkage (mirroring booking_requests.converted_to_job_id
-- from migration 176) so the job, the refund, and the original booking stay
-- connected and the deposit can be credited against the job's price.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS source_booking_request_id UUID
    REFERENCES booking_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_booking_deposit_cents INTEGER
    CHECK (source_booking_deposit_cents IS NULL OR source_booking_deposit_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_jobs_source_booking_request
  ON jobs (source_booking_request_id)
  WHERE source_booking_request_id IS NOT NULL;
