-- Review P3-962: booking-request deposits get a refund record so terminal
-- bookings never strand the customer's money.
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_refund_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS refund_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_booking_requests_deposit_settlement
  ON booking_requests (updated_at)
  WHERE payment_status IN ('paid', 'requires_payment', 'processing')
    AND status IN ('declined', 'expired', 'cancelled', 'accepted_cancelled');
