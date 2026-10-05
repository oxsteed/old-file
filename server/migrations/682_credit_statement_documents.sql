-- Documents are snapshots of existing ledgers, never another ledger.
CREATE TABLE IF NOT EXISTS credit_statement_documents (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product VARCHAR(20) NOT NULL CHECK (product IN ('oxsteed', 'restaurant')),
  account_id BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL CHECK (period_to >= period_from),
  generated_at TIMESTAMPTZ NOT NULL,
  document JSONB NOT NULL,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE (customer_id, product, account_id, currency_code, period_from, period_to)
);
CREATE INDEX IF NOT EXISTS credit_statement_documents_customer_archive
  ON credit_statement_documents(customer_id, product, period_to DESC);
CREATE OR REPLACE FUNCTION prevent_credit_statement_document_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued credit statement documents are immutable' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS credit_statement_documents_immutable ON credit_statement_documents;
CREATE TRIGGER credit_statement_documents_immutable
  BEFORE UPDATE OR DELETE ON credit_statement_documents
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_statement_document_change();
COMMENT ON TABLE credit_statement_documents IS
  'On-demand immutable monthly customer credit reports. Corrections post through authoritative ledgers; originals are retained.';
