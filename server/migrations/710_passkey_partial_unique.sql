-- Passkey credential_id: replace global UNIQUE with partial unique on active rows.
-- Allows re-registration after soft-revoke without the 23505 conflict.

-- User passkeys
ALTER TABLE user_passkeys DROP CONSTRAINT IF EXISTS user_passkeys_credential_id_key;
DROP INDEX IF EXISTS user_passkeys_credential_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_passkeys_credential_active
  ON user_passkeys (credential_id) WHERE revoked_at IS NULL;

-- Admin passkeys
ALTER TABLE admin_passkeys DROP CONSTRAINT IF EXISTS admin_passkeys_credential_id_key;
DROP INDEX IF EXISTS admin_passkeys_credential_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_passkeys_credential_active
  ON admin_passkeys (credential_id) WHERE revoked_at IS NULL;

-- Authenticator metadata from registration (WebAuthn spec).
ALTER TABLE user_passkeys
  ADD COLUMN IF NOT EXISTS backed_up BOOLEAN,
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS aaguid TEXT;
ALTER TABLE admin_passkeys
  ADD COLUMN IF NOT EXISTS backed_up BOOLEAN,
  ADD COLUMN IF NOT EXISTS device_type TEXT,
  ADD COLUMN IF NOT EXISTS aaguid TEXT;
