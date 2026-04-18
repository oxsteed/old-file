-- Migration 071: Add sender_language and translation cache support
-- Enables multi-language support in support tickets with Redis caching

ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_language VARCHAR(5) DEFAULT 'en';

-- Partial index on messages with different sender languages (for translation queries)
CREATE INDEX IF NOT EXISTS idx_support_messages_language
  ON support_messages(ticket_id, sender_language)
  WHERE sender_language != 'en';

COMMENT ON COLUMN support_messages.sender_language IS
  'Language code of the sender (en, es, fr, ht, etc). Used to auto-translate messages when admin/customer speak different languages.';
