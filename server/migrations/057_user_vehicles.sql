-- Migration 057: User Vehicles
-- Stores vehicles registered by users for Car Care planned needs.
-- Data sourced from NHTSA vPIC API (free, no key required).
-- OxSteed v2

CREATE TABLE IF NOT EXISTS user_vehicles (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make_id     INTEGER      NOT NULL,          -- NHTSA Make_ID
  make_name   VARCHAR(80)  NOT NULL,          -- e.g. "Toyota"
  model_id    INTEGER      NOT NULL,          -- NHTSA Model_ID
  model_name  VARCHAR(120) NOT NULL,          -- e.g. "Camry"
  year        SMALLINT,                       -- optional, user-entered
  nickname    VARCHAR(80),                    -- optional label, e.g. "My Commuter"
  notes       TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_vehicles_user ON user_vehicles (user_id);

-- Prevent duplicate same make+model+year per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_vehicles_per_user
  ON user_vehicles (user_id, make_id, model_id, COALESCE(year, 0));

-- Auto-update updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_vehicles_updated_at') THEN
    CREATE TRIGGER trg_user_vehicles_updated_at
      BEFORE UPDATE ON user_vehicles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
