-- Migration 645: investigation access grants (E13).
--
-- Purpose-limited, approver-tied read access for investigations. A grant
-- names an explicit scope (user ids), a purpose, an approver, and an
-- expiry. It starts 'pending'; only the named approver (or a super-admin,
-- never the requester) can activate it. Every elevated read through the
-- investigation endpoint is checked against an active grant and written to
-- the admin audit log with purpose + approver.

CREATE TABLE IF NOT EXISTS investigation_access_grants (
  id                BIGSERIAL    PRIMARY KEY,
  investigation_ref TEXT         NOT NULL,
  requester_admin_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approver_admin_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose           TEXT         NOT NULL,
  scope_user_ids    UUID[]       NOT NULL DEFAULT '{}',
  status            TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  expires_at        TIMESTAMPTZ  NOT NULL,
  decided_at        TIMESTAMPTZ,
  decided_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  revoked_at        TIMESTAMPTZ,
  revoked_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason     TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT investigation_grants_no_self_approval CHECK (requester_admin_id <> approver_admin_id),
  CONSTRAINT investigation_grants_scope_bounded CHECK (cardinality(scope_user_ids) BETWEEN 1 AND 25)
);

CREATE INDEX IF NOT EXISTS idx_investigation_grants_requester
  ON investigation_access_grants (requester_admin_id, status);
CREATE INDEX IF NOT EXISTS idx_investigation_grants_approver
  ON investigation_access_grants (approver_admin_id, status);
