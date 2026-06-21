DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO user_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'users'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS restaurant_help_requests (
      id BIGSERIAL PRIMARY KEY,
      restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      detail TEXT NOT NULL,
      urgency VARCHAR(16) NOT NULL DEFAULT 'High'
        CHECK (urgency IN ('Low', 'Medium', 'High')),
      status VARCHAR(32) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'resolved')),
      linked_location VARCHAR(200),
      resolution_note TEXT,
      created_by %1$s REFERENCES users(id) ON DELETE SET NULL,
      updated_by %1$s REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  $sql$, user_id_type);
END $$;

CREATE INDEX IF NOT EXISTS idx_restaurant_help_requests_restaurant_created
  ON restaurant_help_requests (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_help_requests_restaurant_status
  ON restaurant_help_requests (restaurant_id, status);
