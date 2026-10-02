-- User passkeys for passwordless sign-in. Available to all users.
-- Password remains as the recovery path (unlike admins, TOTP is not required).

CREATE TABLE IF NOT EXISTS user_passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_name VARCHAR(120) NOT NULL DEFAULT 'Passkey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_active
  ON user_passkeys(user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_passkey_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_passkey_challenges_lookup
  ON user_passkey_challenges(user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_passkey_challenges_expiry
  ON user_passkey_challenges(expires_at);
