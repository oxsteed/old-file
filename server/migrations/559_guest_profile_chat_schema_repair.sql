-- Migration 559: repair guest profile chat schema drift.
--
-- The guest chat tables were introduced by several older migrations. A database
-- can have those filenames recorded in _migrations while a table or column is
-- still missing after a partial restore or an interrupted deployment. Keep this
-- migration idempotent so the next deployment repairs that state safely.

BEGIN;

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS allow_guest_contact BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS guest_profile_chat_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  guest_name VARCHAR(200) NOT NULL,
  guest_email VARCHAR(254) NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guest_profile_chat_inbound
  ADD COLUMN IF NOT EXISTS helper_id UUID,
  ADD COLUMN IF NOT EXISTS business_id INTEGER,
  ADD COLUMN IF NOT EXISTS guest_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS guest_email VARCHAR(254),
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_access_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS guest_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

ALTER TABLE guest_profile_chat_inbound
  ALTER COLUMN message DROP NOT NULL;

UPDATE guest_profile_chat_inbound
   SET verification_status = 'unverified'
 WHERE verification_status IS NULL
    OR verification_status NOT IN ('unverified', 'pending', 'verified', 'expired');

ALTER TABLE guest_profile_chat_inbound
  ALTER COLUMN verification_status SET DEFAULT 'unverified',
  ALTER COLUMN verification_status SET NOT NULL;

ALTER TABLE guest_profile_chat_inbound
  DROP CONSTRAINT IF EXISTS guest_profile_chat_inbound_verification_status_check;

ALTER TABLE guest_profile_chat_inbound
  ADD CONSTRAINT guest_profile_chat_inbound_verification_status_check
  CHECK (verification_status IN ('unverified', 'pending', 'verified', 'expired'));

CREATE INDEX IF NOT EXISTS idx_guest_inbound_helper_created
  ON guest_profile_chat_inbound (helper_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_profile_chat_guest_token
  ON guest_profile_chat_inbound (guest_access_token_hash)
  WHERE guest_access_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_profile_chat_inbound_client_request
  ON guest_profile_chat_inbound(client_request_id)
  WHERE client_request_id IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS guest_profile_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL,
  sender_name VARCHAR(255),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CHECK (sender_type IN ('guest', 'helper', 'system_ai'))
);

ALTER TABLE guest_profile_chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_session
  ON guest_profile_chat_messages(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_session_time
  ON guest_profile_chat_messages(session_id, created_at)
  WHERE sender_type != 'guest';

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_profile_chat_messages_client_id
  ON guest_profile_chat_messages(session_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

COMMIT;
