-- Preserve support history when staff consolidate duplicate conversations.
ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS merged_into_conversation_id UUID REFERENCES support_conversations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merge_reason VARCHAR(1000);

CREATE INDEX IF NOT EXISTS idx_support_conversations_merged_into
  ON support_conversations (merged_into_conversation_id)
  WHERE merged_into_conversation_id IS NOT NULL;
