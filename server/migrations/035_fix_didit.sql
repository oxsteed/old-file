-- Migration 035: Fix Didit integration
-- Adds didit_session_id to identity_verifications (missing column the webhook handler references)
-- Adds identity dedup columns to users for one-person-one-account

-- A. Add didit_session_id to identity_verifications
ALTER TABLE identity_verifications
  ADD COLUMN IF NOT EXISTS didit_session_id VARCHAR(255);

-- Allow 'approved' and 'declined' statuses that Didit sends
ALTER TABLE identity_verifications
  DROP CONSTRAINT IF EXISTS chk_iv_status;

ALTER TABLE identity_verifications
  ADD CONSTRAINT chk_iv_status
  CHECK (status IN ('requires_input', 'processing', 'verified', 'canceled', 'approved', 'declined'));

CREATE INDEX IF NOT EXISTS idx_iv_didit_session
  ON identity_verifications(didit_session_id)
  WHERE didit_session_id IS NOT NULL;

-- B. Add identity dedup columns to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS didit_identity_hash  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS didit_verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS didit_status         VARCHAR(30) DEFAULT 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_didit_identity_hash
  ON users (didit_identity_hash)
  WHERE didit_identity_hash IS NOT NULL;
