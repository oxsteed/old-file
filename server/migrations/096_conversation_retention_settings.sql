-- Conversation retention settings
-- Allows configuration of how long archived conversations are kept before automatic cleanup

CREATE TABLE conversation_retention_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  retention_days INT DEFAULT 90, -- Keep archived conversations for 90 days before deletion
  auto_delete BOOLEAN DEFAULT TRUE, -- Whether to automatically delete old conversations
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient lookups
CREATE INDEX idx_conversation_retention_user
ON conversation_retention_settings(user_id);

-- Add audit log for archival events
CREATE TABLE conversation_archive_log (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(20) NOT NULL, -- 'archived' or 'restored'
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient archival log queries
CREATE INDEX idx_conversation_archive_log_conversation
ON conversation_archive_log(conversation_id, created_at DESC);

CREATE INDEX idx_conversation_archive_log_user
ON conversation_archive_log(user_id, created_at DESC);
