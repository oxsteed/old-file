-- Require recent password and email-code verification before a personal data export.

CREATE TABLE IF NOT EXISTS privacy_export_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_token_hash CHAR(64) NOT NULL UNIQUE,
  export_token_hash CHAR(64) UNIQUE,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  locked_until TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_export_verifications_user
  ON privacy_export_verifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privacy_export_verifications_export_token
  ON privacy_export_verifications (export_token_hash)
  WHERE export_token_hash IS NOT NULL;
