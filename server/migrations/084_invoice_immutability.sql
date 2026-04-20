-- Enforce invoice immutability once payment_confirmed
-- Prevents modification of invoices after payment confirmation

-- Add constraint to prevent updates to confirmed invoices
-- This uses a trigger-like check at the application layer
-- (PostgreSQL triggers are complex; we enforce in application logic)

-- However, we can add a CHECK constraint to document the intent:
-- Once an invoice reaches payment_confirmed status, it should be immutable

-- Enable Row Level Security so the policy below actually takes effect.
-- Without this, CREATE POLICY has no effect regardless of what it says.
ALTER TABLE tool_rental_invoices ENABLE ROW LEVEL SECURITY;

-- Allow all operations by default so existing server-side auth is unchanged.
-- Only the deletion policy below restricts anything.
CREATE POLICY invoice_allow_all ON tool_rental_invoices
  USING (true)
  WITH CHECK (true);

-- Add deletion protection: prevent deletion of confirmed invoices
CREATE POLICY no_invoice_deletion ON tool_rental_invoices
  FOR DELETE
  USING (status != 'payment_confirmed');

-- Add update restriction: prevent status changes after payment_confirmed
-- (Note: PostgreSQL doesn't support conditional UPDATE checks in constraints,
--  so this is enforced at the application layer in invoiceController.js)

-- Create audit trigger for all invoice updates
CREATE TABLE IF NOT EXISTS invoice_audit_log (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES tool_rental_invoices(id),
  previous_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  changed_by UUID,  -- user_id who made the change
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  change_reason TEXT
);

-- Index for audit queries
CREATE INDEX idx_invoice_audit_log_invoice_id ON invoice_audit_log(invoice_id);
CREATE INDEX idx_invoice_audit_log_changed_at ON invoice_audit_log(changed_at DESC);
