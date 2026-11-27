-- S-G2 (D-642): Twilio voice proxy for driver-to-contact calls on
-- delivery stops. The driver dials a relay number; Twilio bridges the
-- call to the stop contact's real number, which never leaves the server.
-- One active relay per (job, stop, driver); relays end when the job ends
-- (and the webhook re-checks the job status live, so an un-ended relay
-- still cannot bridge a finished job).
CREATE TABLE IF NOT EXISTS delivery_phone_relays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_job_id BIGINT NOT NULL REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  stop_key TEXT NOT NULL,
  driver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relay_number TEXT NOT NULL,
  target_phone TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  ended_reason VARCHAR(40),
  CONSTRAINT delivery_phone_relays_stop_key_check CHECK (stop_key IN ('pickup', 'dropoff'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_phone_relay_active
  ON delivery_phone_relays (delivery_job_id, stop_key, driver_user_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_delivery_phone_relay_number
  ON delivery_phone_relays (relay_number, status);
