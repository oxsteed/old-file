-- Make support message retries safe across browser reconnects and REST/socket
-- fallback delivery. Existing messages remain valid and receive no synthetic
-- request identifiers.
ALTER TABLE support_conversation_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_conversation_messages_client_id
  ON support_conversation_messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

