-- Guest chat messages and session enhancements
-- Tracks all messages in guest-to-helper conversations

BEGIN;

-- Add guest_id column if not exists (for mapping to users table if guest creates account later)
ALTER TABLE guest_profile_chat_inbound
ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Create guest_profile_chat_messages table
-- Tracks individual messages from guest and helper
CREATE TABLE IF NOT EXISTS guest_profile_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL, -- 'guest', 'helper', 'system_ai'
  sender_name VARCHAR(255),         -- Name of sender (guest name, helper name, etc)
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CHECK (sender_type IN ('guest', 'helper', 'system_ai'))
);

-- Index for efficient message retrieval by session
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_session
  ON guest_profile_chat_messages(session_id, created_at DESC);

-- Index for finding unread messages (those created after last_helper_message_at)
CREATE INDEX IF NOT EXISTS idx_guest_chat_messages_session_time
  ON guest_profile_chat_messages(session_id, created_at)
  WHERE sender_type != 'guest';

COMMIT;
