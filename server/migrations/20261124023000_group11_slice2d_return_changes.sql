-- Group 11 Slice 2d (576, 580, 583, 584): Return + Changes.
-- 576: owner daily return window on the listing, renter return time on the
--   booking, and a renter-proposed / owner-decided return reschedule.
-- 580: owner-written cleaning instructions on the listing.
-- 583: record-only cancellation recovery (refund agreement) per booking.
-- recovery records an agreed refund settlement; the money moves
-- off-platform, and a reschedule never changes charges.

ALTER TABLE tool_rentals
  ADD COLUMN IF NOT EXISTS cleaning_instructions TEXT,
  ADD COLUMN IF NOT EXISTS return_window_start TIME,
  ADD COLUMN IF NOT EXISTS return_window_end TIME;

ALTER TABLE tool_rentals_bookings
  ADD COLUMN IF NOT EXISTS return_time TIME,
  ADD COLUMN IF NOT EXISTS return_reschedule_status VARCHAR(24) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS return_reschedule_proposed_end_date DATE,
  ADD COLUMN IF NOT EXISTS return_reschedule_proposed_time TIME,
  ADD COLUMN IF NOT EXISTS return_reschedule_proposed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_reschedule_proposed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_reschedule_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_reschedule_reason TEXT;

CREATE TABLE IF NOT EXISTS tool_rental_cancellation_recoveries (
  id SERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL UNIQUE REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  refund_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  refund_direction VARCHAR(24) NOT NULL DEFAULT 'none',
  refund_status VARCHAR(24) NOT NULL DEFAULT 'proposed',
  refund_note TEXT,
  proposed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  agreed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_return_window_check'
       AND conrelid = 'tool_rentals'::regclass
  ) THEN
    ALTER TABLE tool_rentals ADD CONSTRAINT tool_rentals_return_window_check
      CHECK (
        (return_window_start IS NULL AND return_window_end IS NULL)
        OR (return_window_start IS NOT NULL AND return_window_end IS NOT NULL
            AND return_window_end > return_window_start)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rentals_bookings_return_reschedule_status_check'
       AND conrelid = 'tool_rentals_bookings'::regclass
  ) THEN
    ALTER TABLE tool_rentals_bookings ADD CONSTRAINT tool_rentals_bookings_return_reschedule_status_check
      CHECK (return_reschedule_status IN ('none', 'proposed', 'approved', 'declined'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rental_cancellation_recoveries_direction_check'
       AND conrelid = 'tool_rental_cancellation_recoveries'::regclass
  ) THEN
    ALTER TABLE tool_rental_cancellation_recoveries ADD CONSTRAINT tool_rental_cancellation_recoveries_direction_check
      CHECK (refund_direction IN ('owner_to_renter', 'renter_to_owner', 'none'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rental_cancellation_recoveries_status_check'
       AND conrelid = 'tool_rental_cancellation_recoveries'::regclass
  ) THEN
    ALTER TABLE tool_rental_cancellation_recoveries ADD CONSTRAINT tool_rental_cancellation_recoveries_status_check
      CHECK (refund_status IN ('proposed', 'agreed', 'settled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tool_rental_cancellation_recoveries_amount_check'
       AND conrelid = 'tool_rental_cancellation_recoveries'::regclass
  ) THEN
    ALTER TABLE tool_rental_cancellation_recoveries ADD CONSTRAINT tool_rental_cancellation_recoveries_amount_check
      CHECK (refund_amount >= 0 AND (refund_amount = 0 OR refund_direction <> 'none') AND (refund_amount <> 0 OR refund_direction = 'none'));
  END IF;
END $$;
