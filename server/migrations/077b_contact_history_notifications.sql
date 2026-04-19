-- Owner contact history and notification preferences
CREATE TABLE tool_contact_history (
  id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  inquirer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_contact TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  contact_count INT DEFAULT 1,
  viewed_at TIMESTAMP
);

CREATE UNIQUE INDEX idx_contact_history_unique ON tool_contact_history(tool_id, inquirer_id, owner_id);

-- Notification preferences
CREATE TABLE tool_rental_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notify_new_tools BOOLEAN DEFAULT TRUE,
  notify_bookings BOOLEAN DEFAULT TRUE,
  notify_messages BOOLEAN DEFAULT TRUE,
  notify_price_drop BOOLEAN DEFAULT TRUE,
  saved_filters JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_notification_prefs_user ON tool_rental_notifications(user_id);
