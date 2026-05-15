-- Migration 181: Messaging System
-- Business-level messaging with channels, direct messages, and real-time support
-- Created: 2026-05-15

BEGIN;

-- Messaging Channels (team and customer communication)
CREATE TABLE IF NOT EXISTS messaging_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('team', 'customer')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  UNIQUE(business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_messaging_channels_business ON messaging_channels(business_id);
CREATE INDEX IF NOT EXISTS idx_messaging_channels_active ON messaging_channels(is_active);
CREATE INDEX IF NOT EXISTS idx_messaging_channels_deleted ON messaging_channels(deleted_at);

-- Channel Membership
CREATE TABLE IF NOT EXISTS messaging_channel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES messaging_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin BOOLEAN DEFAULT false,
  joined_at TIMESTAMP DEFAULT NOW(),
  last_read_at TIMESTAMP,
  last_message_at TIMESTAMP,
  UNIQUE(channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_channel_members_channel ON messaging_channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_messaging_channel_members_user ON messaging_channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messaging_channel_members_admin ON messaging_channel_members(is_admin);

-- Messages
CREATE TABLE IF NOT EXISTS messaging_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES messaging_channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'file')),
  attachment_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messaging_messages_channel ON messaging_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messaging_messages_sender ON messaging_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messaging_messages_created ON messaging_messages(created_at DESC);

-- Reactions/Emojis
CREATE TABLE IF NOT EXISTS messaging_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messaging_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_messaging_reactions_message ON messaging_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_messaging_reactions_user ON messaging_reactions(user_id);

-- Direct Conversations (helper table for DM context)
CREATE TABLE IF NOT EXISTS messaging_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  participant_1_id UUID NOT NULL REFERENCES users(id),
  participant_2_id UUID NOT NULL REFERENCES users(id),
  channel_id UUID REFERENCES messaging_channels(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CHECK (participant_1_id < participant_2_id),
  UNIQUE(business_id, participant_1_id, participant_2_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_conversations_business ON messaging_conversations(business_id);
CREATE INDEX IF NOT EXISTS idx_messaging_conversations_channel ON messaging_conversations(channel_id);

-- Message attachments tracking
CREATE TABLE IF NOT EXISTS messaging_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messaging_messages(id) ON DELETE CASCADE,
  file_name VARCHAR(500),
  file_size_bytes BIGINT,
  file_type VARCHAR(50),
  s3_key VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messaging_attachments_message ON messaging_attachments(message_id);

COMMIT;
