-- Canonical public guest support sessions.
ALTER TABLE support_conversations
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS guest_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS guest_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS guest_access_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS guest_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_verified_at TIMESTAMPTZ;

ALTER TABLE support_conversation_messages
  ALTER COLUMN sender_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_conversations_guest_token
  ON support_conversations (guest_access_token_hash)
  WHERE guest_access_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_guest_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_guest_verifications_lookup
  ON support_guest_verifications (conversation_id, email, created_at DESC);
