-- Group 11 Slice 2c (566, 568, 570, 571, 574, 575): Reserve + Checkout.
-- Adds the booking columns for owner approval (568), pickup appointment
-- time (574) and checkout acknowledgment (575), plus the owner pickup
-- window on the listing (574). Additive only; safe to run twice.
-- No money movement: invoicing stays record-only (D-257).

ALTER TABLE tool_rentals_bookings
  ADD COLUMN IF NOT EXISTS owner_approval VARCHAR(24) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS owner_approval_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS pickup_time TIME,
  ADD COLUMN IF NOT EXISTS checkout_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checkout_acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_report_id UUID REFERENCES equipment_reports(id) ON DELETE SET NULL;

ALTER TABLE tool_rentals
  ADD COLUMN IF NOT EXISTS pickup_window_start TIME,
  ADD COLUMN IF NOT EXISTS pickup_window_end TIME;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_bookings_owner_approval_check'
       AND conrelid = 'tool_rentals_bookings'::regclass
  ) THEN
    ALTER TABLE tool_rentals_bookings ADD CONSTRAINT tool_rentals_bookings_owner_approval_check
      CHECK (owner_approval IN ('pending', 'approved', 'declined'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_pickup_window_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_pickup_window_check
      CHECK (
        (pickup_window_start IS NULL AND pickup_window_end IS NULL)
        OR (pickup_window_start IS NOT NULL AND pickup_window_end IS NOT NULL
            AND pickup_window_end > pickup_window_start)
      );
  END IF;
END $$;
