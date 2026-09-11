-- Optional admin passkeys. TOTP remains mandatory and is the recovery path.

CREATE TABLE IF NOT EXISTS admin_passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_name VARCHAR(120) NOT NULL DEFAULT 'Admin passkey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_passkeys_user_active
  ON admin_passkeys(user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_passkey_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_passkey_challenges_lookup
  ON admin_passkey_challenges(user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_passkey_challenges_expiry
  ON admin_passkey_challenges(expires_at);
