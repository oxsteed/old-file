-- Migration 091: Message edit/delete support
-- Adds edited_at and deleted_at columns to messages table
-- Deleted messages are soft-deleted (not removed from DB)

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Index for finding undeleted messages efficiently
CREATE INDEX IF NOT EXISTS idx_messages_not_deleted
ON messages(conversation_id, created_at DESC)
WHERE deleted_at IS NULL;

-- Index for finding edited messages
CREATE INDEX IF NOT EXISTS idx_messages_edited
ON messages(conversation_id, edited_at DESC)
WHERE edited_at IS NOT NULL;
