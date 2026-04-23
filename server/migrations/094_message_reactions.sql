-- Message reactions system
-- Allows users to react to messages with emoji (thumbs up, heart, laugh, etc.)

CREATE TABLE message_reactions (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(50) NOT NULL, -- emoji name like 'thumbs_up', 'heart', 'laugh', 'sad', 'angry'
  created_at TIMESTAMP DEFAULT NOW(),

  -- Prevent duplicate reactions: one user can only have one type of reaction per message
  CONSTRAINT unique_user_reaction_per_message UNIQUE(message_id, user_id, reaction)
);

-- Index for efficient lookup of reactions for a message
CREATE INDEX idx_message_reactions_message_id
ON message_reactions(message_id);

-- Index for finding all reactions by a user (for audit/moderation)
CREATE INDEX idx_message_reactions_user_id
ON message_reactions(user_id);

-- Index for efficient removal of reactions when user deletes account
CREATE INDEX idx_message_reactions_user_created
ON message_reactions(user_id, created_at DESC);

-- Index for counting reactions per message efficiently
CREATE INDEX idx_message_reactions_message_reaction
ON message_reactions(message_id, reaction);
