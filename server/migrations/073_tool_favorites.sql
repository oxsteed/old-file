-- User tool favorites (wishlist)
CREATE TABLE user_tool_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, tool_id)
);

CREATE INDEX idx_user_tool_favorites_user_id ON user_tool_favorites(user_id);
CREATE INDEX idx_user_tool_favorites_tool_id ON user_tool_favorites(tool_id);
