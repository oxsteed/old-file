-- Migration 691: settlement products in the issuance job/snapshot/artifact schema.
--
-- Extends the Phase 2A/2B infrastructure (migrations 683/684) to the three
-- settlement products: 'restaurant_settlement', 'helper_earnings', 'business'.
-- Additive only: columns are widened or added, constraints are replaced with
-- strictly-wider equivalents, and no existing row is modified.
--
-- Schema notes:
-- - product widens VARCHAR(20) -> VARCHAR(32) on runs, jobs, and snapshots:
--   'restaurant_settlement' is 21 characters.
-- - account_id relaxes to nullable and account_uuid is added on jobs and
--   snapshots: helper_earnings scopes are user UUIDs, not integers. Exactly
--   one of the two is set (XOR check); existing rows keep account_id set.
-- - statement_artifacts gains settlement_document_id so original artifacts
--   for settlement statements link to the 688 archive (document_id stays
--   the credit_statement_documents link). At most one is set; amendment
--   rendition artifacts may set neither (same as today).
-- - Scopes never mix: issuance keys, snapshots, and artifacts all carry the
--   product, and the settlement archive table stays separate from
--   credit_statement_documents.

-- ── issuance runs ──────────────────────────────────────────────────────────
ALTER TABLE statement_issuance_runs
  ALTER COLUMN product TYPE VARCHAR(32);
ALTER TABLE statement_issuance_runs
  DROP CONSTRAINT IF EXISTS statement_issuance_runs_product_check;
ALTER TABLE statement_issuance_runs
  ADD CONSTRAINT statement_issuance_runs_product_check
  CHECK (product IN ('oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business'));

-- ── account jobs ───────────────────────────────────────────────────────────
ALTER TABLE statement_account_jobs
  ALTER COLUMN product TYPE VARCHAR(32);
ALTER TABLE statement_account_jobs
  DROP CONSTRAINT IF EXISTS statement_account_jobs_product_check;
ALTER TABLE statement_account_jobs
  ADD CONSTRAINT statement_account_jobs_product_check
  CHECK (product IN ('oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business'));

ALTER TABLE statement_account_jobs
  ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE statement_account_jobs
  ADD COLUMN IF NOT EXISTS account_uuid UUID NULL;

ALTER TABLE statement_account_jobs
  DROP CONSTRAINT IF EXISTS statement_account_jobs_scope_shape_check;
ALTER TABLE statement_account_jobs
  ADD CONSTRAINT statement_account_jobs_scope_shape_check CHECK (
    (account_id IS NULL) <> (account_uuid IS NULL)
  );

COMMENT ON COLUMN statement_account_jobs.account_uuid IS
  'Account scope for UUID-keyed products (helper_earnings). Exactly one of account_id / account_uuid is set.';

-- ── snapshots ──────────────────────────────────────────────────────────────
ALTER TABLE statement_snapshots
  ALTER COLUMN product TYPE VARCHAR(32);
ALTER TABLE statement_snapshots
  DROP CONSTRAINT IF EXISTS statement_snapshots_product_check;
ALTER TABLE statement_snapshots
  ADD CONSTRAINT statement_snapshots_product_check
  CHECK (product IN ('oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business'));

ALTER TABLE statement_snapshots
  ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE statement_snapshots
  ADD COLUMN IF NOT EXISTS account_uuid UUID NULL;

ALTER TABLE statement_snapshots
  DROP CONSTRAINT IF EXISTS statement_snapshots_scope_shape_check;
ALTER TABLE statement_snapshots
  ADD CONSTRAINT statement_snapshots_scope_shape_check CHECK (
    (account_id IS NULL) <> (account_uuid IS NULL)
  );

COMMENT ON COLUMN statement_snapshots.account_uuid IS
  'Account scope for UUID-keyed products (helper_earnings). Exactly one of account_id / account_uuid is set.';

-- ── artifacts: link originals to the settlement archive ────────────────────
ALTER TABLE statement_artifacts
  ADD COLUMN IF NOT EXISTS settlement_document_id UUID NULL
    REFERENCES settlement_statement_documents(id) ON DELETE RESTRICT;

ALTER TABLE statement_artifacts
  DROP CONSTRAINT IF EXISTS statement_artifacts_document_scope_check;
ALTER TABLE statement_artifacts
  ADD CONSTRAINT statement_artifacts_document_scope_check CHECK (
    NOT (document_id IS NOT NULL AND settlement_document_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS statement_artifacts_settlement_document_idx
  ON statement_artifacts(settlement_document_id);

COMMENT ON COLUMN statement_artifacts.settlement_document_id IS
  'Issued original in settlement_statement_documents (migration 688) this artifact was published from. At most one of document_id / settlement_document_id is set; amendment renditions may set neither.';
