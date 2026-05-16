-- Migration 233: link business_conversations <-> legacy conversations
-- ----------------------------------------------------------------------
-- Phase 1 of the messaging integration. Adds optional FK columns so we
-- can dual-write into business_conversations / business_messages while
-- keeping the legacy conversations / messages flow intact for the
-- customer's personal MessagesPage.
--
-- The columns are nullable; existing rows are unaffected.

ALTER TABLE business_conversations
  ADD COLUMN IF NOT EXISTS legacy_conversation_id UUID NULL
    REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_business_conversations_legacy
  ON business_conversations(legacy_conversation_id)
  WHERE legacy_conversation_id IS NOT NULL;

ALTER TABLE business_messages
  ADD COLUMN IF NOT EXISTS legacy_message_id UUID NULL
    REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_business_messages_legacy
  ON business_messages(legacy_message_id)
  WHERE legacy_message_id IS NOT NULL;

-- Track who currently owns ("claims") a conversation. Used by the
-- assign/release endpoints landed in Phase 1c.
ALTER TABLE business_conversations
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID NULL
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE business_conversations
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_business_conversations_assigned
  ON business_conversations(assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;
