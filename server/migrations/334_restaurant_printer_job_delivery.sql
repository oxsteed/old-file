-- Migration 334: Reliable, device-claimable kitchen printer jobs.

ALTER TABLE restaurant_printer_jobs
  ADD COLUMN IF NOT EXISTS claimed_by_device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_printer_jobs_idempotency
  ON restaurant_printer_jobs (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_printer_jobs_device_queue
  ON restaurant_printer_jobs (claimed_by_device_id, status, created_at ASC);
