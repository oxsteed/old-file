-- Store rental invoice payment handles encrypted; keep masked snapshot in payment_identifier.

ALTER TABLE tool_rental_invoices
  ADD COLUMN IF NOT EXISTS owner_payment_method_id BIGINT REFERENCES owner_payment_methods(id),
  ADD COLUMN IF NOT EXISTS payment_identifier_encrypted VARCHAR(512);

CREATE INDEX IF NOT EXISTS idx_tool_rental_invoices_payment_method
  ON tool_rental_invoices(owner_payment_method_id)
  WHERE owner_payment_method_id IS NOT NULL;
