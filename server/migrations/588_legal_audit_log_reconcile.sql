-- Migration 588: Reconcile legal_audit_log with the writer/reader contract
--
-- Migration 148 created legal_audit_log with a document-centric schema
-- (document_id, section_id, old_values/new_values, CHECK constraints on
-- action_type/resource_type). Migration 164 redefined the table with an
-- actor-centric schema (actor_id, actor_role, document_type, status,
-- metadata) but only runs CREATE TABLE when the table does not exist, so
-- on databases where 148 already ran, 164 is a no-op.
--
-- Both writers (ccpaController.logCCPAAction and
-- legalDocumentsController.logAuditAction) and both readers (getAuditLog,
-- the CSV export) use the 164-style columns. On 148-schema databases every
-- INSERT fails (missing columns, UUID resource_id, CHECK violations on
-- 'ccpa_request'/'acceptance' action types) and the try/catch helpers
-- swallow the error, silently dropping audit rows.
--
-- This migration brings 148-schema tables up to the 164 contract.
-- Idempotent: safe on 148-only, 164-only, both, or neither.

-- Defensive: create the table with the code's contract if it is missing
-- entirely (fresh databases normally get it from 148).
CREATE TABLE IF NOT EXISTS legal_audit_log (
  id BIGSERIAL PRIMARY KEY,
  action_type VARCHAR(50) NOT NULL,
  document_type VARCHAR(100),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(50),
  resource_id VARCHAR(255),
  resource_type VARCHAR(50),
  status VARCHAR(30),
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 148-schema tables lack the actor/status/metadata columns the writers need.
ALTER TABLE legal_audit_log ADD COLUMN IF NOT EXISTS document_type VARCHAR(100);
ALTER TABLE legal_audit_log ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE legal_audit_log ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50);
ALTER TABLE legal_audit_log ADD COLUMN IF NOT EXISTS status VARCHAR(30);
ALTER TABLE legal_audit_log ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 148 defines resource_id as UUID, but writers pass string resource ids
-- (e.g. comma-joined CCPA request id lists). Widen it; existing UUID
-- values cast cleanly to text.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'legal_audit_log'
      AND column_name = 'resource_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE legal_audit_log
      ALTER COLUMN resource_id TYPE VARCHAR(255) USING resource_id::text;
  END IF;
END $$;

-- 148's CHECK constraints reject the action/resource taxonomies the code
-- actually logs ('ccpa_request', 'ccpa_completed', 'acceptance', 'revoked',
-- 'ccpa_request' / 'user_legal_acceptance' resource types). The 164 schema
-- carries no such constraints; drop them so audit rows are not rejected.
ALTER TABLE legal_audit_log DROP CONSTRAINT IF EXISTS valid_action_type;
ALTER TABLE legal_audit_log DROP CONSTRAINT IF EXISTS valid_resource_type;

-- Indexes for the newly added columns (148 already indexes the rest).
CREATE INDEX IF NOT EXISTS idx_legal_audit_log_document_type ON legal_audit_log(document_type);
CREATE INDEX IF NOT EXISTS idx_legal_audit_log_actor_id ON legal_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_legal_audit_log_status ON legal_audit_log(status);
