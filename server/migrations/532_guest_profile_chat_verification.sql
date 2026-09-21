-- Guest profile chat email verification (OTP) + access tokens.
-- Mirrors support guest verify rigor but stays on guest_profile_chat_* stores.

BEGIN;

ALTER TABLE guest_profile_chat_inbound
  ALTER COLUMN message DROP NOT NULL;

ALTER TABLE guest_profile_chat_inbound
  ADD COLUMN IF NOT EXISTS guest_access_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS guest_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) NOT NULL DEFAULT 'unverified';

ALTER TABLE guest_profile_chat_inbound
  DROP CONSTRAINT IF EXISTS guest_profile_chat_inbound_verification_status_check;

ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT guest_profile_chat_inbound_verification_status_check
  CHECK (verification_status IN ('unverified', 'pending', 'verified', 'expired'));

CREATE INDEX IF NOT EXISTS idx_guest_profile_chat_guest_token
  ON guest_profile_chat_inbound (guest_access_token_hash)
  WHERE guest_access_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS guest_profile_chat_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  email VARCHAR(254) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_profile_chat_verifications_lookup
  ON guest_profile_chat_verifications (session_id, email, created_at DESC);

COMMIT;
