CREATE TABLE IF NOT EXISTS restaurant_kiosk_settings (
  restaurant_id BIGINT PRIMARY KEY REFERENCES food_restaurants(id) ON DELETE CASCADE,
  preferred_language VARCHAR(32) NOT NULL DEFAULT 'English',
  locked_mode BOOLEAN NOT NULL DEFAULT TRUE,
  auto_reset_seconds INTEGER NOT NULL DEFAULT 8 CHECK (auto_reset_seconds BETWEEN 3 AND 60),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
