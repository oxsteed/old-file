-- Group 13 Slice 4g (681-685): cashier shifts for the OxSteed Credit kiosk.
-- A shift is device-bound (one open shift per kiosk device) and records the
-- cashier's working location. The shift summary and the closeout checklist
-- are derived from the existing kiosk ledger records at read/close time;
-- this table stores only the shift itself and the closeout snapshot, never
-- a second ledger.
CREATE TABLE IF NOT EXISTS oxsteed_credit_kiosk_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id BIGINT NOT NULL REFERENCES restaurant_app_devices(id) ON DELETE RESTRICT,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closeout JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status = 'open' OR closed_at IS NOT NULL),
  CHECK (status = 'closed' OR closed_at IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_kiosk_shifts_one_open_per_device
  ON oxsteed_credit_kiosk_shifts (device_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_credit_kiosk_shifts_device_opened
  ON oxsteed_credit_kiosk_shifts (device_id, opened_at DESC);
-- The cashier transaction read filters ledger rows by the device recorded in
-- the row metadata (see creditKioskCashier.js); an expression index keeps
-- that read off a full scan.
CREATE INDEX IF NOT EXISTS idx_credit_tx_kiosk_device_created
  ON oxsteed_credit_transactions ((metadata ->> 'kioskDeviceId'), created_at DESC);
