-- Analytics event tracking
CREATE TABLE tool_rentals_analytics (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tool_id BIGINT REFERENCES tool_rentals(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('view','favorite','inquire','book','review')),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_analytics_user_id ON tool_rentals_analytics(user_id);
CREATE INDEX idx_analytics_tool_id ON tool_rentals_analytics(tool_id);
CREATE INDEX idx_analytics_event_type ON tool_rentals_analytics(event_type);
CREATE INDEX idx_analytics_created_at ON tool_rentals_analytics(created_at);
