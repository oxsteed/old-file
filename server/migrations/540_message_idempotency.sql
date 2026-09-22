-- Make direct conversation sends safe to retry after a lost response or
-- reconnect. Existing messages remain valid and receive no synthetic IDs.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_client_id
  ON messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
