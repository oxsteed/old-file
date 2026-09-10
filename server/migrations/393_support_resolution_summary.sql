ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS resolution_summary TEXT;
