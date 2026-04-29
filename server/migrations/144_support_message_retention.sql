-- Migration 144: Support Messages with 180-day Auto-Retention
-- Stores all customer-agent chat conversations with auto-expiry timestamps
-- GDPR/CCPA compliant: Messages auto-delete after 180 days

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system')),
  sender_id UUID,
  sender_name VARCHAR(255),
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text',
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '180 days',
  deleted_at TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON support_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_expires_at ON support_messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_id ON support_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_soft_delete ON support_messages(deleted_at) WHERE deleted_at IS NOT NULL;

-- Add retention tracking columns to support_conversations if needed
ALTER TABLE IF EXISTS support_conversations
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP DEFAULT NOW();
