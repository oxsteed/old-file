-- Migration 728: QR Credit payments.
--
-- Phase 5 — Credit Everywhere: QR codes can be paid with OxSteed Credit
-- (locked decision #10: wire behind flags before un-hide). The qr_payments
-- table was Stripe-only: stripe_checkout_session_id NOT NULL, no
-- payment_method, status limited to Stripe lifecycle values.

-- Allow rows without a Stripe session (Credit payments).
ALTER TABLE qr_payments
  ALTER COLUMN stripe_checkout_session_id DROP NOT NULL;

-- Distinguish Credit from Stripe payments.
ALTER TABLE qr_payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'stripe'
    CHECK (payment_method IN ('stripe', 'oxsteed_credit'));

-- Credit payments settle immediately; 'paid' marks them done.
ALTER TABLE qr_payments DROP CONSTRAINT IF EXISTS qr_payments_status_check;
ALTER TABLE qr_payments
  ADD CONSTRAINT qr_payments_status_check
    CHECK (status IN ('pending', 'succeeded', 'expired', 'failed', 'paid'));
