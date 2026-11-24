-- Group 11 Slice 2d (576, 580, 583, 584): Return + Changes.
-- 576: owner daily return window on the listing, renter return time on the
--   booking, and a renter-proposed / owner-decided return reschedule.
-- 580: owner-written cleaning instructions on the listing.
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
