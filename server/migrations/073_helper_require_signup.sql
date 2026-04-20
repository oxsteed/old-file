-- Migration 073: Add helper "require contact signup" toggle
-- Allows helpers to require customers to verify email/phone before messaging/booking

ALTER TABLE helper_profiles
ADD COLUMN require_contact_signup BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for filtering helpers with this setting enabled
CREATE INDEX idx_helper_profiles_require_signup
ON helper_profiles(user_id)
WHERE require_contact_signup = TRUE;

-- Audit log for when this setting changes (optional)
ALTER TABLE helper_profiles
ADD COLUMN contact_gate_enabled_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN helper_profiles.require_contact_signup IS
'When true, guests must verify email/phone before messaging or booking';
