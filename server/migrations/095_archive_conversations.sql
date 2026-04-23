-- Archive conversations functionality
-- Allows users to archive conversations instead of permanently deleting them
-- Archived conversations can be restored and are hidden from the inbox by default

ALTER TABLE conversations
ADD COLUMN archived_at TIMESTAMP NULL,
ADD COLUMN archived_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for efficient querying of archived conversations (for restoration UI)
CREATE INDEX idx_conversations_archived
ON conversations(archived_at DESC NULLS LAST)
WHERE archived_at IS NOT NULL;

-- Index for finding non-archived conversations (default inbox view)
CREATE INDEX idx_conversations_active_not_archived
ON conversations(customer_id, helper_id, last_message_at DESC)
WHERE archived_at IS NULL AND status = 'active';

-- Add comment to document the archive workflow
COMMENT ON COLUMN conversations.archived_at IS 'Timestamp when conversation was archived; NULL = not archived. Archived conversations are hidden from inbox but can be restored.';
