-- Prevent one Stripe PaymentIntent from being recorded against multiple
-- payment rows. Existing production data was checked before adding this guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent_unique
  ON payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
