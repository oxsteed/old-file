-- Business Launch Program - Admin Notes and Custom Messages
-- Allows admins to leave internal notes and send custom messages to clients

CREATE TABLE IF NOT EXISTS consulting_request_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note_text TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT TRUE, -- internal notes not visible to client
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_consulting_notes_request_id ON consulting_request_notes(request_id);
CREATE INDEX idx_consulting_notes_admin_id ON consulting_request_notes(admin_id);
CREATE INDEX idx_consulting_notes_created_at ON consulting_request_notes(created_at DESC);

-- Custom messages sent to clients
CREATE TABLE IF NOT EXISTS consulting_request_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  message_html TEXT NOT NULL,
  message_plain TEXT,
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, failed
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_consulting_messages_request_id ON consulting_request_messages(request_id);
CREATE INDEX idx_consulting_messages_admin_id ON consulting_request_messages(admin_id);
CREATE INDEX idx_consulting_messages_status ON consulting_request_messages(status);
CREATE INDEX idx_consulting_messages_created_at ON consulting_request_messages(created_at DESC);
