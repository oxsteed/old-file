-- Stripe Connect card payments for business/helper invoices (destination charges).

ALTER TABLE business_invoices
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_invoices_stripe_payment_intent
  ON business_invoices (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
