-- Migration 074: Guest conversations table
-- Stores one-way messages from unauthenticated guests to helpers
-- Until guest creates an account, these are tracked separately

CREATE TABLE guest_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_email VARCHAR(255) NOT NULL,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(message) <= 4000),
  guest_session_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, replied, converted (to real conversation)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  replied_at TIMESTAMP WITH TIME ZONE,
  converted_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for queries
CREATE INDEX idx_guest_conversations_helper ON guest_conversations(helper_id);
CREATE INDEX idx_guest_conversations_email ON guest_conversations(guest_email);
CREATE INDEX idx_guest_conversations_status ON guest_conversations(status);
CREATE INDEX idx_guest_conversations_created ON guest_conversations(created_at DESC);

-- Constraint: email format
ALTER TABLE guest_conversations
ADD CONSTRAINT guest_conversations_email_format
CHECK (guest_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$');

COMMENT ON TABLE guest_conversations IS
'One-way messages from unauthenticated guests to helpers pending signup/conversion';
COMMENT ON COLUMN guest_conversations.status IS
'pending: awaiting helper reply, replied: helper contacted guest, converted: guest signed up and created real conversation';
