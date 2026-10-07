-- Migration 721: grant scope type on investigation access grants.
--
-- One Truth P1 (item 11/12.2): delegated trust/fraud analysts access One
-- Truth through the same purpose-limited, approver-tied grant machinery as
-- user investigations. The scope type records which surface the grant was
-- requested for so governance can distinguish analyst delegations from
-- per-user investigation grants. Existing rows default to
-- 'user_investigation'.

ALTER TABLE investigation_access_grants
  ADD COLUMN IF NOT EXISTS grant_scope TEXT NOT NULL DEFAULT 'user_investigation'
  CHECK (grant_scope IN ('user_investigation', 'fraud_analyst'));

CREATE INDEX IF NOT EXISTS idx_investigation_grants_scope
  ON investigation_access_grants (grant_scope, status);
