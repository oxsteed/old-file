-- Migration 181: Business messaging system (team + customer conversations)
-- Supports team-internal messages and customer booking inquiries per business

CREATE TABLE IF NOT EXISTS business_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_type VARCHAR(50) NOT NULL CHECK (conversation_type IN ('team', 'customer')),
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  created_by_id UUID NOT NULL REFERENCES users(id),
  subject VARCHAR(500),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'resolved', 'spam')),
  last_message_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT team_conv_no_customer CHECK ((conversation_type = 'team' AND customer_id IS NULL) OR conversation_type = 'customer'),
  CONSTRAINT customer_conv_needs_email CHECK ((conversation_type = 'customer' AND customer_email IS NOT NULL) OR conversation_type = 'team')
);

CREATE INDEX idx_business_conversations_business_id ON business_conversations(business_id);
CREATE INDEX idx_business_conversations_status ON business_conversations(status);
CREATE INDEX idx_business_conversations_last_message_at ON business_conversations(last_message_at DESC);
CREATE INDEX idx_business_conversations_type ON business_conversations(conversation_type);

CREATE TABLE IF NOT EXISTS business_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES business_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name VARCHAR(255),
  sender_email VARCHAR(255),
  sender_type VARCHAR(50) NOT NULL CHECK (sender_type IN ('team_member', 'customer')),
  content TEXT NOT NULL,
  message_type VARCHAR(50) NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'action')),
  is_edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMP WITH TIME ZONE,
  edited_by_id UUID REFERENCES users(id),
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_messages_conversation_id ON business_messages(conversation_id);
CREATE INDEX idx_business_messages_created_at ON business_messages(created_at DESC);
CREATE INDEX idx_business_messages_sender_type ON business_messages(sender_type);
CREATE INDEX idx_business_messages_deleted_at ON business_messages(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS business_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES business_messages(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(2048) NOT NULL,
  file_size_bytes BIGINT,
  file_type VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_message_attachments_message_id ON business_message_attachments(message_id);

CREATE TABLE IF NOT EXISTS business_conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES business_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_muted BOOLEAN DEFAULT FALSE,
  last_read_message_id UUID REFERENCES business_messages(id),
  last_read_at TIMESTAMP WITH TIME ZONE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id, user_id)
);

CREATE INDEX idx_business_conversation_participants_conversation_id ON business_conversation_participants(conversation_id);
CREATE INDEX idx_business_conversation_participants_user_id ON business_conversation_participants(user_id);
