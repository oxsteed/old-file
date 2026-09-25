-- Guest profile chat access codes.
-- A code is scoped to one helper/business session and expires after 30 days.

BEGIN;

ALTER TABLE guest_profile_chat_inbound
  ADD COLUMN IF NOT EXISTS guest_history_access_code_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS guest_history_access_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_history_access_code_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_guest_profile_chat_history_access
  ON guest_profile_chat_inbound (helper_id, business_id, lower(guest_email), guest_history_access_code_expires_at)
  WHERE guest_history_access_code_hash IS NOT NULL;

COMMIT;
