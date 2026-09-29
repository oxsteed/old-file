-- 585_consulting_invoice_idempotency.sql
-- Admin audit: idempotency guard for manually generated consulting invoices.
-- Additive-only: a nullable column plus a unique index. Existing rows are
-- untouched; multiple NULL idempotency keys do not conflict in PostgreSQL.

ALTER TABLE consulting_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_consulting_invoices_idempotency_key
  ON consulting_invoices (idempotency_key);
