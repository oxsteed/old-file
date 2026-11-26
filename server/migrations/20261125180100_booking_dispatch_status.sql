-- Groups 5-6 item 260 (G5-11): booking-level dispatch state.
-- A pending business booking dispatched to a member carries
-- dispatch_status='pending' until that member confirms it via accept,
-- which flips it to 'confirmed'. Transfer clears it (a transfer is a
-- different action, not a dispatch). Additive and idempotent.
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS dispatch_status TEXT
    CHECK (dispatch_status IS NULL OR dispatch_status IN ('pending', 'confirmed')),
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_booking_requests_dispatch_pending
  ON booking_requests (business_id, dispatch_status)
  WHERE dispatch_status = 'pending';
