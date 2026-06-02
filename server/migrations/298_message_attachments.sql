-- Persist mobile/web chat attachment metadata alongside each message.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
