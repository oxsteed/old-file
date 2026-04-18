-- Migration 074: Support Helper-Scoped Invoices
-- Makes business_id nullable so invoices can be helper-scoped (no business)
-- When business_id IS NULL, the invoice belongs to the helper user only

ALTER TABLE business_invoices
  ALTER COLUMN business_id DROP NOT NULL;

-- Update constraint to allow NULL business_id
ALTER TABLE business_invoices
  DROP CONSTRAINT business_invoices_business_id_fkey,
  ADD CONSTRAINT business_invoices_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

-- Update indexes to handle helper-scoped invoices (business_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_business_invoices_user_id
  ON business_invoices(user_id)
  WHERE business_id IS NULL;

-- Constraint: invoice must be scoped to either a business OR be helper-scoped
-- (but not both - if it has a business_id, that business must belong to the user)
