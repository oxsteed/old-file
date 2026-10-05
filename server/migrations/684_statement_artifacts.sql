-- Phase 2B: consistent statement snapshots and private artifact publication.
--
-- statement_snapshots freezes the exact rows, totals and running balances of one
-- statement issuance, keyed off the deterministic issuance key shared with the
-- issuance job pipeline (stmt:v1:<product>:<accountId>:<currency>:<from>:<to>:<customerId>).
-- Chunks partition the canonical row list with stable composite keyset cursors
-- (underlying entry created_at and id, in statement order) so a background
-- renderer can materialize the same rows later without re-reading the ledger.
--
-- statement_artifacts tracks private PDF uploads through a verify-before-ready
-- publication workflow. Rows move staged -> verifying -> ready, or to failed.
-- An artifact is never marked ready on the upload attempt alone: the stored
-- object is read back and its byte length and SHA-256 are recomputed before the
-- ready transition. Issued originals are append-only; corrections post through
-- the authoritative ledgers and re-render as separate labeled renditions.
-- Object keys are opaque (stmt/<uuid4>.pdf); no PII ever appears in a key.
-- Snapshots are money-neutral: they record ledger evidence, never move funds.

CREATE TABLE IF NOT EXISTS statement_snapshots (
  id UUID PRIMARY KEY,
  issuance_key VARCHAR(200) NOT NULL UNIQUE,
  product VARCHAR(20) NOT NULL CHECK (product IN ('oxsteed', 'restaurant')),
  account_id BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL CHECK (period_to >= period_from),
  cutoff_at TIMESTAMPTZ NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  row_count INT NOT NULL CHECK (row_count >= 0),
  total_credits_minor BIGINT NOT NULL,
  total_debits_minor BIGINT NOT NULL,
  opening_minor BIGINT NOT NULL,
  closing_minor BIGINT NOT NULL,
  source_hash CHAR(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  chunk_count INT NOT NULL DEFAULT 1 CHECK (chunk_count >= 1),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS statement_snapshot_chunks (
  snapshot_id UUID NOT NULL REFERENCES statement_snapshots(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL CHECK (chunk_index >= 0),
  cursor_from TEXT NOT NULL,
  cursor_to TEXT,
  row_count INT NOT NULL CHECK (row_count >= 0),
  credits_minor BIGINT NOT NULL,
  debits_minor BIGINT NOT NULL,
  chunk_hash CHAR(64) NOT NULL CHECK (chunk_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (snapshot_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS statement_artifacts (
  id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES statement_snapshots(id) ON DELETE RESTRICT,
  document_id UUID NULL REFERENCES credit_statement_documents(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('original', 'rendition')),
  language VARCHAR(10) NOT NULL,
  renderer_version VARCHAR(40) NOT NULL,
  template_version VARCHAR(40) NOT NULL,
  font_version VARCHAR(40) NOT NULL,
  byte_length BIGINT NOT NULL CHECK (byte_length >= 0),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  media_type VARCHAR(80) NOT NULL,
  object_key VARCHAR(400) NOT NULL UNIQUE,
  state VARCHAR(20) NOT NULL CHECK (state IN ('staged', 'verifying', 'ready', 'failed')) DEFAULT 'staged',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS statement_publication_attempts (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES statement_artifacts(id) ON DELETE CASCADE,
  attempt INT NOT NULL CHECK (attempt >= 1),
  outcome VARCHAR(20),
  verified_bytes BIGINT,
  verified_hash CHAR(64) CHECK (verified_hash IS NULL OR verified_hash ~ '^[a-f0-9]{64}$'),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS statement_snapshots_account_period_idx
  ON statement_snapshots(product, account_id, currency_code, period_to DESC);
CREATE INDEX IF NOT EXISTS statement_snapshot_chunks_snapshot_idx
  ON statement_snapshot_chunks(snapshot_id, chunk_index);
CREATE INDEX IF NOT EXISTS statement_artifacts_snapshot_idx
  ON statement_artifacts(snapshot_id, kind, language);
CREATE INDEX IF NOT EXISTS statement_publication_attempts_artifact_idx
  ON statement_publication_attempts(artifact_id, attempt);

COMMENT ON TABLE statement_snapshots IS
  'Frozen, money-neutral evidence for one statement issuance: exact row list, minor-unit totals and running balances as of the issuance cutoff. Append-only manifest; keyed by the deterministic issuance key.';
COMMENT ON TABLE statement_snapshot_chunks IS
  'Chunk descriptors partitioning a snapshot row list with stable (created_at, id) keyset cursors, per-chunk counts/totals/hashes for reconciliation.';
COMMENT ON TABLE statement_artifacts IS
  'Private statement PDF artifacts (originals and labeled renditions) in the statement-only object namespace. Rows are staged, then verified by reading the stored object back, and only then marked ready. Never served before ready.';
COMMENT ON TABLE statement_publication_attempts IS
  'Audit trail of every artifact publication attempt: upload outcome, reconciled bytes/hash, and failure detail. An attempt alone never marks an artifact ready.';
