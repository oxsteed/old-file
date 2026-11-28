-- Group 14 Slice 5i (741-745, D-784..D-788): coordinate review on top of
-- the audit-request workflow (716-720).
--
-- 741 Accountant invitation: an owner/admin invites an external
--     accountant by email. The invitation carries a hashed one-time code
--     (same HMAC shape as investor invitations); accepting it binds the
--     code to the signed-in account and mints the 718 share grant, so the
--     accountant becomes an auditor with an active grant. No row here
--     grants anything on its own: visibility is still derived per request
--     at read time from the share grant.
-- 742 Audit scope review: the reviewing auditor records an explicit
--     acknowledgment of the request scope (acknowledged / needs
--     clarification), append-only.
-- 743 Record correction request: the auditor asks for a correction to a
--     record (an approved evidence document, or a free-text reference);
--     the owner/admin resolves it addressed / declined, append-only
--     history with the resolution.
-- 744 Internal annotation thread: owner/admin-only notes on the request.
--     Auditors never see these rows (enforced in the route layer: the
--     annotations sub-resource is owner/admin only, 403 for auditors).
-- 745 Review completion notice: no table; the notice type
--     audit_review_completed is registered in the notification catalog
--     and fires from the close transition (see routes/auditRequests.js).
--
-- Group 14 is READ-ONLY (D-408): nothing here moves money; these tables
-- record coordination only, never amounts, journals, or payouts.
--
-- Additive only; safe to run twice (IF NOT EXISTS throughout).
CREATE TABLE IF NOT EXISTS audit_request_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_request_invitations_request
  ON audit_request_invitations (audit_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_request_invitations_email
  ON audit_request_invitations (email, created_at DESC);

-- Audit scope review (742): append-only; the latest row is the current
-- review position. Only the reviewing auditor writes these rows.
CREATE TABLE IF NOT EXISTS audit_request_scope_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision VARCHAR(32) NOT NULL CHECK (decision IN ('acknowledged', 'needs_clarification')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_request_scope_reviews_request
  ON audit_request_scope_reviews (audit_request_id, created_at ASC);

-- Record correction request (743): the auditor asks for a correction to a
-- record. evidence_id names an approved evidence row on the request;
-- record_ref is the free-text reference when no evidence row applies.
-- Exactly one of the two must be present (enforced in the route layer;
-- the CHECK below only bounds lengths).
CREATE TABLE IF NOT EXISTS audit_request_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evidence_id UUID REFERENCES audit_request_evidence(id) ON DELETE SET NULL,
  record_ref TEXT CHECK (record_ref IS NULL OR (char_length(record_ref) >= 1 AND char_length(record_ref) <= 200)),
  detail TEXT NOT NULL CHECK (char_length(detail) >= 1 AND char_length(detail) <= 2000),
  status VARCHAR(16) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'addressed', 'declined')),
  resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_request_corrections_request
  ON audit_request_corrections (audit_request_id, created_at ASC);

-- Internal annotation thread (744): owner/admin-only notes. Append-only.
CREATE TABLE IF NOT EXISTS audit_request_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_request_id UUID NOT NULL REFERENCES audit_requests(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role VARCHAR(32) NOT NULL,
  note TEXT NOT NULL CHECK (char_length(note) >= 1 AND char_length(note) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_request_annotations_request
  ON audit_request_annotations (audit_request_id, created_at ASC);
