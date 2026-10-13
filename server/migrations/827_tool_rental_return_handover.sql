-- Review P3-12-F13: tool rentals had no return/handover step; the owner
-- could mark a booking completed straight from payment_confirmed with no
-- renter return confirmation, condition report, or damage step. A new
-- 'returned' status sits between payment_confirmed and completed: the
-- renter confirms the tool was handed back (optionally noting its
-- condition) or the owner confirms receipt, and only then can the owner
-- complete the booking.
ALTER TABLE tool_rentals_bookings
  DROP CONSTRAINT IF EXISTS tool_rentals_bookings_status_check;

ALTER TABLE tool_rentals_bookings
  ADD CONSTRAINT tool_rentals_bookings_status_check
  CHECK (status IN ('pending', 'invoice_sent', 'payment_confirmed', 'returned', 'completed', 'cancelled'));

ALTER TABLE tool_rentals_bookings
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_condition_note TEXT;
