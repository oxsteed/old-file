-- Guest profile messaging + helper preference for public contact

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS allow_guest_contact BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN helper_profiles.allow_guest_contact IS 'When true, visitors without an account can start a guest message thread from the public profile.';

CREATE TABLE IF NOT EXISTS guest_profile_chat_inbound (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  guest_name VARCHAR(200) NOT NULL,
  guest_email VARCHAR(254) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_inbound_helper_created
  ON guest_profile_chat_inbound (helper_id, created_at DESC);
