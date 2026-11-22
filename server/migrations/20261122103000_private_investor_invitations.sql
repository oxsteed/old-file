-- Private investor admission. Investor access starts with an administrator
-- invitation; this table never grants a capability by itself.
CREATE TABLE IF NOT EXISTS investor_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  invite_code_hash CHAR(64) NOT NULL,
  proof_hash CHAR(64),
  proof_expires_at TIMESTAMPTZ,
  verification_code_hash CHAR(64),
  verification_expires_at TIMESTAMPTZ,
  verification_sent_at TIMESTAMPTZ,
  invite_attempts INTEGER NOT NULL DEFAULT 0,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT investor_invitations_email_normalized CHECK (email = lower(trim(email)))
);

CREATE INDEX IF NOT EXISTS idx_investor_invitations_email
  ON investor_invitations (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investor_invitations_active
  ON investor_invitations (expires_at)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS investor_admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL UNIQUE REFERENCES investor_invitations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, email)
);

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS investor_invitation_id UUID REFERENCES investor_invitations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_investor_admissions_user
  ON investor_admissions (user_id, status);
