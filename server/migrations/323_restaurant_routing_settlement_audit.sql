-- Migration 323: Restaurant routing, settlement, and audit completion.
-- Adds the final backend tables needed for printer/device routing, delivery
-- settlement, and crew task history.

CREATE TABLE IF NOT EXISTS restaurant_kitchen_stations (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  device_id BIGINT REFERENCES restaurant_app_devices(id) ON DELETE SET NULL,
  printer_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_kitchen_stations_restaurant
  ON restaurant_kitchen_stations(restaurant_id, is_active, name);

CREATE TABLE IF NOT EXISTS restaurant_menu_item_station_routes (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  menu_item_id BIGINT NOT NULL REFERENCES food_menu_items(id) ON DELETE CASCADE,
  station_id BIGINT NOT NULL REFERENCES restaurant_kitchen_stations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_item_station_routes_restaurant
  ON restaurant_menu_item_station_routes(restaurant_id, station_id);

CREATE TABLE IF NOT EXISTS restaurant_printer_jobs (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  station_id BIGINT REFERENCES restaurant_kitchen_stations(id) ON DELETE SET NULL,
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE CASCADE,
  job_type VARCHAR(40) NOT NULL DEFAULT 'kitchen_ticket'
    CHECK (job_type IN ('kitchen_ticket','receipt','expo_label','runner_handoff')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','printed','failed','cancelled')),
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_printer_jobs_restaurant_status
  ON restaurant_printer_jobs(restaurant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_runner_settlements (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT REFERENCES restaurant_runner_tasks(id) ON DELETE SET NULL,
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  runner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  tip_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  cash_collected_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_collected_cents >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','disputed','voided')),
  note TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_settlements_restaurant
  ON restaurant_runner_settlements(restaurant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_runner_settlements_runner
  ON restaurant_runner_settlements(runner_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_crew_task_events (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES restaurant_crew_tasks(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL,
  old_status VARCHAR(32),
  new_status VARCHAR(32),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_task_events_task
  ON restaurant_crew_task_events(task_id, created_at ASC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_kitchen_stations_updated_at') THEN
    CREATE TRIGGER trg_restaurant_kitchen_stations_updated_at
      BEFORE UPDATE ON restaurant_kitchen_stations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_printer_jobs_updated_at') THEN
    CREATE TRIGGER trg_restaurant_printer_jobs_updated_at
      BEFORE UPDATE ON restaurant_printer_jobs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_runner_settlements_updated_at') THEN
    CREATE TRIGGER trg_restaurant_runner_settlements_updated_at
      BEFORE UPDATE ON restaurant_runner_settlements
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
