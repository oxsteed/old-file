-- Migration 542: idempotency for legacy Direct and support message flows.
-- A client-generated UUID makes a network retry return the original message
-- instead of appending a duplicate message or reopening a case twice.

ALTER TABLE direct_request_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_request_messages_client_id
  ON direct_request_messages (quote_request_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_ticket_client_id
  ON support_messages (ticket_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_tickets_client_request_id
  ON support_tickets (client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_conversations_client_request_id
  ON support_conversations (client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE restaurant_support_case_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_support_case_messages_client_id
  ON restaurant_support_case_messages (case_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE restaurant_support_cases
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_support_cases_client_request_id
  ON restaurant_support_cases (client_request_id)
  WHERE client_request_id IS NOT NULL;
