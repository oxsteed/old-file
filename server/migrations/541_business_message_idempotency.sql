-- Make Business Hub team-message retries safe after a lost response or
-- reconnect. Existing business messages remain valid without synthetic IDs.
ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_messages_conversation_client_id
  ON business_messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
