-- Add referred_by to track who referred each user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

-- Store referral code through OTP-based customer registration flow
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS referral_ref VARCHAR(50);
