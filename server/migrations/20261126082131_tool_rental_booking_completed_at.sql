-- Wave 3 (599, D-574): record when a tool-rental booking completed, so
-- the owner dashboard's 30-day permitted-earnings tile can date earnings
-- by completion instead of by the booking end date (the client already
-- reads completed_at first). Backfill is deliberately absent: bookings
-- completed before this column existed keep completed_at NULL and fall
-- back to end_date, the same fallback the client already applies.
ALTER TABLE tool_rentals_bookings
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
