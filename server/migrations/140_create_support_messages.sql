-- Migration 140: Support Messages with 180-day Auto-Retention
-- Stores all customer-agent chat conversations with auto-expiry timestamps

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system')),
  sender_id UUID,
  sender_name VARCHAR(255),
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text', -- 'text', 'file', 'system_notification'
  metadata JSONB, -- For storing file URLs, typing indicators, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '180 days',
  deleted_at TIMESTAMP
);

-- Add missing columns if table already existed with different schema
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(50) DEFAULT 'text';
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '180 days';
ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Indexes for efficient querying
CREATE INDEX idx_support_messages_ticket_id ON support_messages(ticket_id);
CREATE INDEX idx_support_messages_expires_at ON support_messages(expires_at);
CREATE INDEX idx_support_messages_created_at ON support_messages(created_at DESC);
CREATE INDEX idx_support_messages_sender_id ON support_messages(sender_id);

-- Ensure old messages can be queried for deletion
CREATE INDEX idx_support_messages_soft_delete ON support_messages(deleted_at) WHERE deleted_at IS NOT NULL;

-- Add created_at and updated_at to support_conversations if not exists
ALTER TABLE support_conversations
ADD COLUMN IF NOT EXISTS conversation_started_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP DEFAULT NOW();

-- Index for conversation querying
CREATE INDEX IF NOT EXISTS idx_support_conversations_last_message
ON support_conversations(last_message_at DESC);
