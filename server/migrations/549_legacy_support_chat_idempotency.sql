-- 549_legacy_support_chat_idempotency.sql
-- Give the legacy support-chat entry point the same retry contract as the
-- canonical support and messaging routes.

BEGIN;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS support_client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_support_client_request
  ON conversations(customer_id, support_client_request_id)
  WHERE support_client_request_id IS NOT NULL;

COMMIT;
