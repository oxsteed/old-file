-- Group 14 Slice 5d (716-720, D-430/D-431): audit-request intake workflow.
--
-- A NEW workflow, not a reuse of statement_reports (D-430): request ->
-- approved evidence -> time-limited auditor share -> follow-up -> receipt.
-- Group 14 is READ-ONLY (D-408): nothing here moves money; these tables
-- record coordination only, never amounts, journals, or payouts.
--
-- Scope fail-closed: no scope columns are stored because visibility is
-- derived per request at read time (requester sees their own requests;
-- admins see all; an auditor sees only a request where they hold an
-- active, unexpired, unrevoked grant). A stranger sees nothing.
--
-- Additive only; safe to run twice (IF NOT EXISTS throughout).
CREATE TABLE IF NOT EXISTS audit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 200),
  audit_type VARCHAR(32) NOT NULL CHECK (audit_type IN ('financial', 'compliance', 'tax', 'operational', 'other')),
  scope TEXT NOT NULL CHECK (char_length(scope) >= 1 AND char_length(scope) <= 2000),
  auditor_email TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_requests_requested_by
  ON audit_requests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_requests_status
  ON audit_requests (status, created_at DESC);

-- Approved evidence selection (717): one row per document proposed for a
-- request. The document must belong to the requester (checked in the route
-- layer against credit_statement_documents.customer_id); the row only
-- records the approval step. Status moves proposed -> approved/rejected.
CREATE TABLE IF NOT EXISTS audit_request_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audit_request_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_audit_request_evidence_request
  ON audit_request_evidence (audit_request_id, created_at DESC);

-- Time-limited evidence share (718, D-410 flip): a grant naming the
-- auditor, the request, and an expiry. The grant is the authority for an
-- auditor to mint a fresh signed link per approved document; the signed
-- link itself stays a self-download with TTL 60..3600s. Revocation closes
-- the grant immediately; expiry closes it at expires_at. At most one
-- active (unrevoked) grant per (request, auditor).
CREATE TABLE IF NOT EXISTS audit_request_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  auditor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No expires_at CHECK: the route validates the TTL bounds (D-431), and
  -- an administrator must be able to backdate expiry without the row
  -- refusing the update.
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_request_shares_active
  ON audit_request_shares (audit_request_id, auditor_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_request_shares_auditor
  ON audit_request_shares (auditor_user_id, expires_at DESC);

-- Reviewer follow-up (719): a message thread on the request itself,
-- mirroring the dispute-message pattern (idempotency key, author role).
CREATE TABLE IF NOT EXISTS audit_request_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role VARCHAR(32) NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) >= 1 AND char_length(message) <= 5000),
  idempotency_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audit_request_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_audit_request_messages_request
  ON audit_request_messages (audit_request_id, created_at ASC);

-- Evidence package receipt (720): the reviewer acknowledges receipt of
-- the approved-evidence package. package is a snapshot of the approved
-- document ids at receipt time; the receipt is append-only.
CREATE TABLE IF NOT EXISTS audit_request_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  received_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_request_receipts_request
  ON audit_request_receipts (audit_request_id, created_at DESC);
