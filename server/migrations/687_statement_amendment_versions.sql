-- Migration 687: statement amendment versions (Phase 4, workstream 3).
--
-- Each approved amendment produces a NEW immutable row in
-- statement_amendment_versions. The issued original in
-- credit_statement_documents is never updated or deleted: migration 682's
-- unique constraint and immutability trigger are untouched by this file.
--
-- Version model:
--   * one row per approved amendment, keyed to the original it corrects;
--   * UNIQUE (original_document_id, revision_number) gives the ordered
--     v1, v2, ... chain; revision N supersedes revision N-1 (or the original
--     for N = 1) via supersedes_version_id;
--   * UNIQUE (proposal_id): exactly one version per proposal, so a retried
--     publication after a storage failure can never duplicate a version;
--   * the full amended document envelope (original/adjustment/revised
--     totals, amendment provenance, continuity disclosure) is stored as
--     JSONB with a SHA-256 content hash; rows are frozen by the trigger below.
--
-- This migration also extends statement_amendment_proposals (migration 686)
-- with the fields the proposal-creation endpoint captures. Every new column
-- carries a default (or is nullable) so proposals created before this
-- migration keep working, and the 686 transition trigger is strengthened
-- (CREATE OR REPLACE, never weakened) to freeze the new proposal fields once
-- a proposal leaves 'proposed'.

-- ── 686 proposal table: additive columns ─────────────────────────────────
ALTER TABLE statement_amendment_proposals
  ADD COLUMN IF NOT EXISTS amendment_type VARCHAR(20) NOT NULL DEFAULT 'clerical'
    CHECK (amendment_type IN ('clerical', 'accounting')),
  ADD COLUMN IF NOT EXISTS presentation VARCHAR(20) NOT NULL DEFAULT 'restated'
    CHECK (presentation IN ('restated', 'later_period')),
  ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS compensating_transaction_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS restate_forward BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS original_document_hash CHAR(64) NULL
    CHECK (original_document_hash IS NULL OR original_document_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN IF NOT EXISTS ledger_fingerprint CHAR(64) NULL
    CHECK (ledger_fingerprint IS NULL OR ledger_fingerprint ~ '^[a-f0-9]{64}$'),
  ADD COLUMN IF NOT EXISTS base_revision_number INTEGER NOT NULL DEFAULT 0
    CHECK (base_revision_number >= 0);

COMMENT ON COLUMN statement_amendment_proposals.amendment_type IS
  'clerical: presentation/label corrections with no accounting change. accounting: references posted compensating ledger transactions; the amended statement is re-derived from the ledger after those post.';
COMMENT ON COLUMN statement_amendment_proposals.presentation IS
  'restated: the period is re-derived including the corrections (backdated corrections are explicitly dated and disclosed). later_period: the correction takes effect in a later period; this period''s balances are unchanged and the adjustment is disclosed, never double counted.';
COMMENT ON COLUMN statement_amendment_proposals.compensating_transaction_refs IS
  'JSONB array of {id, amountCents, direction, postedAt, kind} for the authoritative ledger transactions this amendment references. Each id may be referenced by at most one amendment per original statement.';

-- Strengthen (never weaken) the 686 transition trigger: the correction scope
-- is frozen together with the decision.
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
  IF NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.amendment_type IS DISTINCT FROM OLD.amendment_type
     OR NEW.presentation IS DISTINCT FROM OLD.presentation
     OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
     OR NEW.compensating_transaction_refs IS DISTINCT FROM OLD.compensating_transaction_refs
     OR NEW.restate_forward IS DISTINCT FROM OLD.restate_forward
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.original_document_hash IS DISTINCT FROM OLD.original_document_hash
     OR NEW.ledger_fingerprint IS DISTINCT FROM OLD.ledger_fingerprint
     OR NEW.base_revision_number IS DISTINCT FROM OLD.base_revision_number THEN
    RAISE EXCEPTION 'Statement amendment proposal correction scope is immutable' USING ERRCODE = '55000';
  END IF;
  NEW.decided_at = transaction_timestamp();
  RETURN NEW;
END;
$$;

-- ── Amendment versions: one immutable row per approved amendment ───────────
CREATE TABLE IF NOT EXISTS statement_amendment_versions (
  id UUID PRIMARY KEY,
  original_document_id UUID NOT NULL REFERENCES credit_statement_documents(id) ON DELETE RESTRICT,
  proposal_id UUID NOT NULL REFERENCES statement_amendment_proposals(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  amendment_type VARCHAR(20) NOT NULL CHECK (amendment_type IN ('clerical', 'accounting')),
  presentation VARCHAR(20) NOT NULL CHECK (presentation IN ('restated', 'later_period')),
  document JSONB NOT NULL,
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  artifact_id UUID NULL REFERENCES statement_artifacts(id) ON DELETE RESTRICT,
  supersedes_version_id UUID NULL REFERENCES statement_amendment_versions(id) ON DELETE RESTRICT,
  prior_version_closing_minor BIGINT NOT NULL,
  revised_closing_minor BIGINT NOT NULL,
  continuity_status VARCHAR(20) NOT NULL CHECK (continuity_status IN ('continuous', 'restated_forward')),
  next_period_document_id UUID NULL REFERENCES credit_statement_documents(id) ON DELETE RESTRICT,
  next_period_issued_opening_minor BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (original_document_id, revision_number),
  UNIQUE (proposal_id),
  CONSTRAINT statement_amendment_version_chain CHECK (
    (revision_number = 1 AND supersedes_version_id IS NULL)
    OR (revision_number > 1 AND supersedes_version_id IS NOT NULL)
  ),
  CONSTRAINT statement_amendment_version_continuity CHECK (
    (continuity_status = 'continuous' AND next_period_document_id IS NULL)
    OR (continuity_status = 'restated_forward' AND next_period_document_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS statement_amendment_versions_original_idx
  ON statement_amendment_versions(original_document_id, revision_number);
CREATE INDEX IF NOT EXISTS statement_amendment_versions_proposal_idx
  ON statement_amendment_versions(proposal_id);

-- Published versions are immutable, mirroring migration 682's guarantee for
-- issued originals. Corrections to a corrected statement are new versions.
CREATE OR REPLACE FUNCTION prevent_statement_amendment_version_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued statement amendment versions are immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS statement_amendment_versions_immutable ON statement_amendment_versions;
CREATE TRIGGER statement_amendment_versions_immutable
  BEFORE UPDATE OR DELETE ON statement_amendment_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_statement_amendment_version_change();

COMMENT ON TABLE statement_amendment_versions IS
  'Immutable corrected versions of issued credit statements. Each approved amendment inserts one row; originals are never edited. revision_number orders the chain per original; proposal_id is unique so retried publications never duplicate.';

-- ── Publication attempts: durable trail for approved-but-unpublished ────────
-- When storage fails after approval, the proposal stays approved with no
-- version row; the retry path (POST /ops/amendments/:id/retry-publish) is
-- idempotent on proposal_id. Attempts are recorded here for operators.
CREATE TABLE IF NOT EXISTS statement_amendment_publication_attempts (
  id UUID PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES statement_amendment_proposals(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  outcome VARCHAR(40) NOT NULL,
  version_id UUID NULL REFERENCES statement_amendment_versions(id) ON DELETE SET NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX IF NOT EXISTS statement_amendment_publication_attempts_proposal_idx
  ON statement_amendment_publication_attempts(proposal_id, attempt DESC);

COMMENT ON TABLE statement_amendment_publication_attempts IS
  'Per-attempt publication trail for approved statement amendments. Mirrors statement_publication_attempts; a version row is only ever inserted once per proposal.';
