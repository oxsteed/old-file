-- Phase 2C: operator-facing review queue for statement amendment proposals.
--
-- The amendments worker (not landed as of this migration) proposes
-- corrections against issued statement evidence; proposals are reviewed
-- here with maker-checker separation: the admin who proposed a correction
-- can never approve or reject it. Decided rows are frozen by the trigger
-- below; terminal rows are never mutated again.
--
-- A proposal never edits or replaces the issued original: approval marks
-- the proposal decided and the correction posts through the authoritative
-- ledgers, re-rendering as a separate labeled rendition (see migration 684).
-- No PII or financial document bodies are stored here: reason text is
-- operator-written, and the document itself stays in
-- credit_statement_documents / statement_artifacts.

CREATE TABLE IF NOT EXISTS statement_amendment_proposals (
  id UUID PRIMARY KEY,
  issuance_key VARCHAR(200) NOT NULL,
  product VARCHAR(20) NOT NULL CHECK (product IN ('oxsteed', 'restaurant')),
  account_id BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL CHECK (period_to >= period_from),
  document_id UUID NULL REFERENCES credit_statement_documents(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  status VARCHAR(20) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected')),
  proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  decided_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NULL,
  decision_reason TEXT NULL CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 2000),
  CONSTRAINT statement_amendment_decision_consistent
    CHECK (
      (status = 'proposed' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS statement_amendment_proposals_status_idx
  ON statement_amendment_proposals(status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS statement_amendment_proposals_issuance_idx
  ON statement_amendment_proposals(issuance_key);

-- Decided proposals are frozen; proposed rows may only transition to a
-- terminal state with a decider recorded. The application layer enforces
-- maker-checker (decided_by != proposed_by) before this trigger runs.
CREATE OR REPLACE FUNCTION guard_statement_amendment_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'Statement amendment proposal % is % and cannot be changed', OLD.id, OLD.status
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Statement amendment proposal % must transition to approved or rejected', OLD.id
      USING ERRCODE = '55000';
  END IF;
  IF NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at THEN
    RAISE EXCEPTION 'Statement amendment proposal authorship is immutable' USING ERRCODE = '55000';
  END IF;
  NEW.decided_at = transaction_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS statement_amendment_proposals_guard ON statement_amendment_proposals;
CREATE TRIGGER statement_amendment_proposals_guard
  BEFORE UPDATE ON statement_amendment_proposals
  FOR EACH ROW EXECUTE FUNCTION guard_statement_amendment_transition();

COMMENT ON TABLE statement_amendment_proposals IS
  'Review queue for statement amendment proposals (maker-checker). A proposal never mutates the issued original; approval routes the correction through the authoritative ledgers as a new labeled rendition.';
