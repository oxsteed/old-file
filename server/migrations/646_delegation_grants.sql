-- Migration 646: delegation_grants (M1 — Workforce Identity, Delegation, Access Lifecycle).
--
-- A recorded authority registry for admin-to-admin delegation: a grantor
-- (an admin) delegates a bounded set of scopes to a grantee (another admin)
-- for a bounded time window (max 30 days). Every grant is written to the
-- admin audit log on create and on revoke.
--
-- NOTE: this table is a registry with expiry and audit only. It does NOT
-- change runtime authorization; enforcing delegation at request time is
-- future work.

CREATE TABLE IF NOT EXISTS delegation_grants (
  id                BIGSERIAL     PRIMARY KEY,
  grantor_admin_id  UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_admin_id  UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes            TEXT[]        NOT NULL,
  reason            TEXT,
  status            TEXT          NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at        TIMESTAMPTZ   NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason     TEXT,
  CONSTRAINT delegation_grants_no_self_grant CHECK (grantor_admin_id <> grantee_admin_id),
  CONSTRAINT delegation_grants_scopes_bounded CHECK (cardinality(scopes) BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS idx_delegation_grants_grantee
  ON delegation_grants (grantee_admin_id, status);
CREATE INDEX IF NOT EXISTS idx_delegation_grants_grantor
  ON delegation_grants (grantor_admin_id, status);
CREATE INDEX IF NOT EXISTS idx_delegation_grants_expiry
  ON delegation_grants (expires_at)
  WHERE status = 'active';
