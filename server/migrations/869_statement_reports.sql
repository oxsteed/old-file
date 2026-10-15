-- Migration 869: statement-level problem reports (workstream: statement-level reporting).
--
-- A statement-level report flags a problem with a WHOLE statement document
-- without selecting a single entry: a missing transaction, a wrong opening
-- balance, an incomplete period, or another statement-wide problem. Entry
-- drilldown cases (disputes / support tickets) already exist in
-- server/routes/statementInvestigation.js; this table is the companion
-- surface for problems that cannot be pinned to one row.
--
-- Reports never move money: they are read-only observations attached to an
-- issued (immutable) statement document. Status transitions (open ->
-- under_review -> resolved / closed) are performed by support tooling, never
-- by the report author. document_id is nullable so a report can be filed
-- before a period is issued (e.g. "my period looks incomplete" for the
-- current, not-yet-issued month); the document routes in this workstream
-- always pass the issued document id.
--
-- document_id is a plain UUID, not a foreign key: reports span two archive
-- tables (credit_statement_documents and settlement_statement_documents)
-- and both are append-only, so the write path (which loads and authorizes
-- the document before inserting) is the integrity point. No join may treat
-- the id as belonging to one archive without checking both.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS plus guarded indexes.

CREATE TABLE IF NOT EXISTS statement_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product VARCHAR(32) NOT NULL
    CHECK (product IN ('oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business')),
  document_id UUID NULL,
  report_type VARCHAR(32) NOT NULL
    CHECK (report_type IN ('missing_transaction', 'wrong_opening_balance', 'incomplete_period', 'other_statement_problem')),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'resolved', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_statement_reports_document_user
  ON statement_reports(document_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_statement_reports_user_status
  ON statement_reports(user_id, status, created_at DESC);

COMMENT ON TABLE statement_reports IS
  'Statement-level problem reports: missing transaction, wrong opening balance, incomplete period, or other statement-wide problem. Read-only observations; status transitions belong to support tooling.';
