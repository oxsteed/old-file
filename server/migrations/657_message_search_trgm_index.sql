-- Migration 657: GIN trigram index for user-to-user message search.
--
-- searchMessages (messageController) filters messages.content with
-- ILIKE '%q%'. Without an index that is a sequential scan over the whole
-- messages table, which grows with every conversation. pg_trgm has been
-- enabled since migration 001, so this only adds the GIN index that lets
-- substring searches use trigram matching. IF NOT EXISTS keeps the
-- migration idempotent for databases that already carry the index.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON messages USING GIN (content gin_trgm_ops);
