-- Make profile and legacy guest-chat message retries replay-safe.
BEGIN;

ALTER TABLE guest_profile_chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_profile_chat_messages_client_id
  ON guest_profile_chat_messages(session_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE guest_profile_chat_inbound
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_profile_chat_inbound_client_request
  ON guest_profile_chat_inbound(client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
