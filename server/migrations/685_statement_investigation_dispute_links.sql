-- Migration 685: link credit disputes to the statement investigation that opened them.
--
-- Statement transaction investigation (workstream 4) files "I don't recognize
-- this" reports into the EXISTING oxsteed_credit_disputes case system. These
-- nullable columns record which immutable statement document and entry the
-- report came from. They are provenance metadata only: they never change
-- dispute eligibility, deadlines, or resolution rules, and the migration 452
-- integrity trigger still guards ownership columns on UPDATE.
CREATE TABLE IF NOT EXISTS oxsteed_credit_disputes (
  id UUID PRIMARY KEY
);

ALTER TABLE oxsteed_credit_disputes
  ADD COLUMN IF NOT EXISTS statement_document_id UUID REFERENCES credit_statement_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS statement_revision INTEGER,
  ADD COLUMN IF NOT EXISTS statement_entry_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS statement_product VARCHAR(20),
  ADD COLUMN IF NOT EXISTS statement_account_id BIGINT,
  ADD COLUMN IF NOT EXISTS statement_period_from DATE,
  ADD COLUMN IF NOT EXISTS statement_period_to DATE;

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_disputes_statement
  ON oxsteed_credit_disputes(statement_document_id, statement_entry_id);
