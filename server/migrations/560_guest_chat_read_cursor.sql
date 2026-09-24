-- Track each helper or business representative's read cursor for guest chats.
BEGIN;

ALTER TABLE guest_profile_chat_inbound
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_guest_message_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS guest_profile_chat_read_cursors (
  session_id UUID NOT NULL REFERENCES guest_profile_chat_inbound(id) ON DELETE CASCADE,
  reader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id BIGINT NOT NULL DEFAULT 0,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, reader_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_profile_chat_unread_cursor
  ON guest_profile_chat_messages(session_id, id)
  WHERE sender_type = 'guest';

COMMIT;
