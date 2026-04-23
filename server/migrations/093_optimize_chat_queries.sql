-- Chat query performance optimization
-- Add indexes for common query patterns

-- Index for getMessages pagination (conversation_id + created_at)
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
ON messages (conversation_id, created_at DESC NULLS LAST)
WHERE deleted_at IS NULL;

-- Index for searchMessages (conversation_id + content search)
CREATE INDEX IF NOT EXISTS idx_messages_conv_search
ON messages (conversation_id, sender_id, created_at DESC)
WHERE deleted_at IS NULL;

-- Index for unread message count queries (conversation_id + read status)
CREATE INDEX IF NOT EXISTS idx_messages_unread
ON messages (conversation_id, sender_id, is_read)
WHERE deleted_at IS NULL AND is_read = FALSE;

-- Index for conversation listing (customer + helper)
CREATE INDEX IF NOT EXISTS idx_conversations_participants
ON conversations (customer_id, helper_id, last_message_at DESC);

-- Index for helper's active conversations
CREATE INDEX IF NOT EXISTS idx_conversations_helper
ON conversations (helper_id, is_active, last_message_at DESC)
WHERE is_active = TRUE;

-- Index for business reps (business_members lookup)
CREATE INDEX IF NOT EXISTS idx_business_members_status
ON business_members (business_id, member_id, status)
WHERE status = 'active';

-- Index for conversation+business lookup (for chat context)
CREATE INDEX IF NOT EXISTS idx_conversations_business
ON conversations (business_id, customer_id, helper_id)
WHERE business_id IS NOT NULL;
