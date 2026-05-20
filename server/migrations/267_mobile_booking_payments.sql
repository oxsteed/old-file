-- Mobile booking payments
-- Lets the native booking flow collect an optional deposit or full service amount
-- before the helper accepts the request.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS payment_requirement VARCHAR(20)
    CHECK (payment_requirement IS NULL OR payment_requirement IN ('deposit', 'full')),
  ADD COLUMN IF NOT EXISTS payment_amount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (payment_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required', 'requires_payment', 'processing', 'paid', 'failed', 'refunded')),
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_booking_requests_payment_status
  ON booking_requests(payment_status);

CREATE INDEX IF NOT EXISTS idx_booking_requests_payment_intent
  ON booking_requests(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
