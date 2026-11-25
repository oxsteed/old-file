-- Group 14 Slice 5b (706, D-423): link existing payment records to business
-- invoices, so a bookkeeper can see which payment settled an invoice.
--
-- A link is a manual record-matching assertion, never auto-matching and
-- never a money write: linking changes no amount on the invoice
-- (amount_paid / status / paid_at are written only by POST .../pay).
-- One invoice can carry several links (partial payments); the cumulative
-- linked amount must not exceed the invoice total.
--
-- payment_type:
--   'stripe_payment_intent' — reference is a Stripe payment intent id
--     (format-checked only; existence cannot be checked without Stripe,
--     so the reference is the business owner's assertion, as mark-paid is).
--   'credit_transaction'    — reference is an oxsteed_credit_transactions
--     id; the link endpoint verifies the row exists (unknown is 404).
--   'manual_reference'      — free-form bank/cheque reference, any
--     non-empty string.
-- Scope is derived from the invoice at read/write time (the invoice row
-- carries business_id/user_id), so this table needs no store-boundary
-- audit registration. Additive only; safe to run twice.
CREATE TABLE IF NOT EXISTS business_invoice_payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id BIGINT NOT NULL REFERENCES business_invoices(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payment_type VARCHAR(32) NOT NULL CHECK (payment_type IN ('stripe_payment_intent', 'credit_transaction', 'manual_reference')),
  payment_reference TEXT NOT NULL CHECK (char_length(payment_reference) >= 1 AND char_length(payment_reference) <= 255),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  linked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, payment_type, payment_reference)
);
CREATE INDEX IF NOT EXISTS idx_business_invoice_payment_links_invoice
  ON business_invoice_payment_links (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_invoice_payment_links_business
  ON business_invoice_payment_links (business_id, created_at DESC);
