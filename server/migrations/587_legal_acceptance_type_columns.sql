-- 587_legal_acceptance_type_columns.sql
-- Sentry fix (BACKEND-2P): reconcile user_legal_acceptances with
-- server/controllers/legalDocumentsController.js. Migration 145 created the
-- table with document_id (a UUID FK to legal_documents), while migration
-- 162 re-created it with document_type IF NOT EXISTS, which no-ops where
-- 145 already ran. The controller exclusively uses the 162 model:
-- document_type holds a document type slug (e.g. 'contractor_agreement',
-- 'dispute_resolution', validated against VALID_DOCUMENT_TYPES), and the
-- controller also reads/writes first_name, last_name, created_at,
-- updated_at and deleted_at (soft revoke). None of these columns exist
-- under the 145 model, so every /api/legal acceptance/history endpoint
-- failed with "column does not exist".
--
-- Additive-only: all columns are nullable so legacy 145-model rows are
-- untouched. document_type is deliberately NOT backfilled from
-- document_id: document_id references legal_documents(id), whose category
-- taxonomy ('terms_of_service', 'privacy_policy', 'helper_agreement', ...)
-- does not map onto the controller's document_type slugs
-- ('contractor_agreement', 'dispute_resolution', 'account_termination',
-- ...), so any mapping would invent data. first_name/last_name ARE
-- backfilled from the 145-model signature_first_name/signature_last_name
-- columns, and created_at from accepted_at (an acceptance row was created
-- when it was accepted).

ALTER TABLE user_legal_acceptances
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill display names from the 145-model signature columns.
UPDATE user_legal_acceptances
SET first_name = signature_first_name
WHERE first_name IS NULL AND signature_first_name IS NOT NULL;

UPDATE user_legal_acceptances
SET last_name = signature_last_name
WHERE last_name IS NULL AND signature_last_name IS NOT NULL;

-- Backfill created_at from accepted_at for rows that predate the column.
UPDATE user_legal_acceptances
SET created_at = accepted_at
WHERE created_at IS NULL AND accepted_at IS NOT NULL;

-- Indexes matching the lookups the controller performs (same index names
-- and shapes as migration 162 intended before it became a no-op).
CREATE INDEX IF NOT EXISTS idx_user_legal_acceptances_document_type
  ON user_legal_acceptances(document_type);

CREATE INDEX IF NOT EXISTS idx_user_legal_acceptances_document_user
  ON user_legal_acceptances(document_type, user_id);

-- Idempotency guard matching the controller's "alreadyAccepted" dedupe:
-- one row per user, document type and version. Partial so legacy
-- 145-model rows (document_type NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_legal_acceptances_user_doc_version
  ON user_legal_acceptances (user_id, document_type, version_number)
  WHERE document_type IS NOT NULL;
