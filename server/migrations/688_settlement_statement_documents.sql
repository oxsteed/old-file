-- Migration 688: settlement statement documents (workstream 8).
--
-- Append-only archive for the merchant/settlement statement products:
--   'restaurant_settlement' — per (restaurant_id, currency_code)
--   'helper_earnings'       — per (helper user_id, currency_code)
--   'business'              — per (business_id, currency_code)
--
-- This table is deliberately SEPARATE from credit_statement_documents
-- (migration 682). Customer stored-value statements and merchant/settlement
-- statements must never share an archive scope: customer_id on this table is
-- never a wallet holder reference, and no query here may join wallet
-- balances into merchant money owed (or vice versa).
--
-- Scope shape (exactly one scope column set per product):
--   restaurant_settlement → scope_restaurant_id NOT NULL, others NULL
--   helper_earnings       → scope_helper_user_id NOT NULL, others NULL
--   business              → scope_business_id NOT NULL, others NULL
--
-- Like 682: issued originals are immutable (trigger), corrections post
-- through the amendment workflow's rederive rebuild (the amendment
-- proposal/version tables FK to credit_statement_documents, so formal
-- amendments for these products need a follow-up FK migration; this table
-- only guarantees the originals are append-only and content-addressed).

CREATE TABLE IF NOT EXISTS settlement_statement_documents (
  id UUID PRIMARY KEY,
  product VARCHAR(32) NOT NULL
    CHECK (product IN ('restaurant_settlement', 'helper_earnings', 'business')),
  scope_restaurant_id BIGINT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  scope_business_id BIGINT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  scope_helper_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL CHECK (period_to >= period_from),
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  document JSONB NOT NULL,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT settlement_statement_documents_scope_shape_check CHECK (
    (product = 'restaurant_settlement' AND scope_restaurant_id IS NOT NULL
      AND scope_business_id IS NULL AND scope_helper_user_id IS NULL)
    OR (product = 'helper_earnings' AND scope_helper_user_id IS NOT NULL
      AND scope_restaurant_id IS NULL AND scope_business_id IS NULL)
    OR (product = 'business' AND scope_business_id IS NOT NULL
      AND scope_restaurant_id IS NULL AND scope_helper_user_id IS NULL)
  )
);

-- One archived original per (product, scope, currency, period). Partial
-- indexes (not one nullable-column unique constraint) so NULL scope columns
-- cannot defeat the dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_statement_docs_restaurant
  ON settlement_statement_documents (scope_restaurant_id, currency_code, period_from, period_to)
  WHERE product = 'restaurant_settlement';
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_statement_docs_helper
  ON settlement_statement_documents (scope_helper_user_id, currency_code, period_from, period_to)
  WHERE product = 'helper_earnings';
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_statement_docs_business
  ON settlement_statement_documents (scope_business_id, currency_code, period_from, period_to)
  WHERE product = 'business';

-- Archive listings: newest period first per scope.
CREATE INDEX IF NOT EXISTS idx_settlement_statement_docs_restaurant_archive
  ON settlement_statement_documents (scope_restaurant_id, currency_code, period_to DESC)
  WHERE product = 'restaurant_settlement';
CREATE INDEX IF NOT EXISTS idx_settlement_statement_docs_helper_archive
  ON settlement_statement_documents (scope_helper_user_id, currency_code, period_to DESC)
  WHERE product = 'helper_earnings';
CREATE INDEX IF NOT EXISTS idx_settlement_statement_docs_business_archive
  ON settlement_statement_documents (scope_business_id, currency_code, period_to DESC)
  WHERE product = 'business';

-- Issued originals are immutable: corrections are amendments, never edits.
CREATE OR REPLACE FUNCTION prevent_settlement_statement_document_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued settlement statement documents are immutable' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS settlement_statement_documents_immutable ON settlement_statement_documents;
CREATE TRIGGER settlement_statement_documents_immutable
  BEFORE UPDATE OR DELETE ON settlement_statement_documents
  FOR EACH ROW EXECUTE FUNCTION prevent_settlement_statement_document_change();

COMMENT ON TABLE settlement_statement_documents IS
  'On-demand immutable monthly settlement/earnings statements for restaurant_settlement, helper_earnings, and business products. Separate from credit_statement_documents: merchant money and customer stored value never share an archive scope.';
