-- Add idempotency protection to invoice creation
-- Prevents duplicate invoices if request is retried after network failure

ALTER TABLE tool_rental_invoices
ADD COLUMN idempotency_key VARCHAR(64) UNIQUE;

-- Create index for efficient lookup
CREATE INDEX idx_invoices_idempotency_key ON tool_rental_invoices(idempotency_key);

-- Create unique constraint on booking_id + idempotency_key to prevent duplicates per booking
ALTER TABLE tool_rental_invoices
ADD CONSTRAINT invoice_idempotency_per_booking UNIQUE(booking_id, idempotency_key);
