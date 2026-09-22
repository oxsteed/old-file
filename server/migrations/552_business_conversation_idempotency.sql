-- Migration 552: prevent duplicate Business Hub threads after client retries.

ALTER TABLE business_conversations
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_conversations_creator_request
  ON business_conversations (business_id, created_by_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
