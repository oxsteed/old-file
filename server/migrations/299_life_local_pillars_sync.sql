-- Migration 299: durable backend sync for iOS Life local pillars.
-- Money entries use expenses; vehicles use user_vehicles; habits get their own table.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS client_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_user_client_id
  ON expenses(user_id, client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE user_vehicles
  ADD COLUMN IF NOT EXISTS client_id UUID,
  ADD COLUMN IF NOT EXISTS vin VARCHAR(17),
  ADD COLUMN IF NOT EXISTS mileage INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_oil_change_mile INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_service_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_vehicles_user_client_id
  ON user_vehicles(user_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS life_habits (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id            UUID NOT NULL,
  name                 VARCHAR(120) NOT NULL,
  icon                 VARCHAR(80) NOT NULL DEFAULT 'circle.fill',
  streak               INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  completed_today      BOOLEAN NOT NULL DEFAULT false,
  target_days_per_week INTEGER NOT NULL DEFAULT 1 CHECK (target_days_per_week BETWEEN 1 AND 7),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_life_habits_user
  ON life_habits(user_id, completed_today, updated_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_life_habits_updated_at') THEN
    CREATE TRIGGER trg_life_habits_updated_at
      BEFORE UPDATE ON life_habits
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
