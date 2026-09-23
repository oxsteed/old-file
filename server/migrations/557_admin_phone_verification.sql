-- Admin-triggered phone verification challenges.
-- Codes are never stored in plaintext and are only issued for one user at a time.

CREATE TABLE IF NOT EXISTS admin_phone_verification_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  phone_number VARCHAR(20) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'aws_end_user_messaging_sms',
  provider_message_id VARCHAR(255),
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'verified', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_phone_verification_user
  ON admin_phone_verification_challenges (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_phone_verification_active
  ON admin_phone_verification_challenges (user_id, expires_at)
  WHERE delivery_status = 'sent' AND verified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_phone_verification_admin
  ON admin_phone_verification_challenges (created_by_admin_id, created_at DESC);
