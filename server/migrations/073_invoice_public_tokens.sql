-- Migration 073: Invoice Public Tokens for External Access
-- Adds public_token UUID to business_invoices for secure public viewing
-- and enables dual-track delivery (internal notifications + public links).

ALTER TABLE business_invoices
  ADD COLUMN IF NOT EXISTS public_token UUID UNIQUE;

-- Index for fast lookups by public token
CREATE INDEX IF NOT EXISTS idx_business_invoices_public_token
  ON business_invoices (public_token)
  WHERE public_token IS NOT NULL;
