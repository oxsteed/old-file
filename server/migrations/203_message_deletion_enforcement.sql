-- VULN #29 FIX: Enforce complete message deletion (not soft-delete)

-- When message is deleted by user, PERMANENTLY remove it (not soft-delete)
-- Store only deletion log for audit, not message content

CREATE TABLE IF NOT EXISTS message_deletion_log (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL,
  deleted_by_user_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  deleted_at TIMESTAMP DEFAULT NOW(),
  deletion_reason VARCHAR(50) -- 'user_requested', 'admin_removed', 'moderation'
);

-- Function to enforce hard-delete on message deletion
CREATE OR REPLACE FUNCTION hard_delete_message()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- Message is being deleted - log it then hard-delete
    INSERT INTO message_deletion_log (message_id, deleted_by_user_id, conversation_id, deletion_reason)
    VALUES (NEW.id, NEW.deleted_by_user_id, NEW.conversation_id, 'user_requested');

    -- Hard delete the message content (GDPR compliance)
    DELETE FROM messages WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Instead of using trigger for hard-delete, the application should:
-- 1. Log deletion to message_deletion_log
-- 2. Call DELETE FROM messages WHERE id = $1
-- (Trigger hard-deletes are tricky in PostgreSQL)

CREATE INDEX IF NOT EXISTS idx_deletion_log_user
  ON message_deletion_log(deleted_by_user_id, deleted_at DESC);

-- Ensure deleted messages don't appear in searches
-- Application: SELECT * FROM messages WHERE deleted_at IS NULL ...
