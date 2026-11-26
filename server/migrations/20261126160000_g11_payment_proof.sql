-- G11-A1/A3 (D-603): two-step payment confirmation. The renter records
-- payment proof (reference + amount) on the invoice; the owner then
-- confirms receipt. The booking leaves invoice_sent only on the owner's
-- confirmation, so renter self-attestation alone never flips
-- payment_confirmed. Record-only money (D-257): no platform money moves.
ALTER TABLE tool_rental_invoices
  ADD COLUMN IF NOT EXISTS payment_proof_reference VARCHAR(200),
  ADD COLUMN IF NOT EXISTS payment_proof_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS payment_proof_submitted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS payment_proof_submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;
