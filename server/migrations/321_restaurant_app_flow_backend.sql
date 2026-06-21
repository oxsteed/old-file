-- Migration 321: Restaurant app flow backend completion.
-- Adds the missing connective tissue needed by Manager, POS, Kitchen, Display,
-- Crew, Inventory, and the customer Restaurant app without changing existing
-- route contracts.

ALTER TABLE food_restaurants
  ADD COLUMN IF NOT EXISTS delivery_radius_meters INTEGER CHECK (delivery_radius_meters IS NULL OR delivery_radius_meters >= 0),
  ADD COLUMN IF NOT EXISTS tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps >= 0),
  ADD COLUMN IF NOT EXISTS service_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (service_fee_bps >= 0),
  ADD COLUMN IF NOT EXISTS online_order_pause_reason TEXT;

ALTER TABLE food_order_items
  ADD COLUMN IF NOT EXISTS kitchen_status VARCHAR(32) NOT NULL DEFAULT 'queued'
    CHECK (kitchen_status IN ('queued','preparing','ready','held','bumped','cancelled')),
  ADD COLUMN IF NOT EXISTS station_label VARCHAR(80),
  ADD COLUMN IF NOT EXISTS bumped_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS restaurant_app_devices (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  app_key VARCHAR(32) NOT NULL CHECK (app_key IN ('manager','pos','kitchen','display','inventory','crew','runner','restaurant')),
  device_name VARCHAR(160) NOT NULL,
  mode VARCHAR(64),
  pairing_code VARCHAR(24) UNIQUE,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paired','disabled')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  paired_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_app_devices_restaurant
  ON restaurant_app_devices(restaurant_id, app_key, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_pos_shifts (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  staff_label VARCHAR(160),
  drawer_name VARCHAR(120),
  status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_cash_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_cash_cents >= 0),
  closing_cash_cents INTEGER CHECK (closing_cash_cents IS NULL OR closing_cash_cents >= 0),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_shifts_restaurant
  ON restaurant_pos_shifts(restaurant_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_kitchen_events (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE CASCADE,
  food_order_item_id BIGINT REFERENCES food_order_items(id) ON DELETE SET NULL,
  event_type VARCHAR(48) NOT NULL,
  from_status VARCHAR(48),
  to_status VARCHAR(48),
  station_label VARCHAR(80),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_kitchen_events_order
  ON restaurant_kitchen_events(restaurant_id, food_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_crew_tasks (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  detail TEXT,
  role_label VARCHAR(120),
  priority VARCHAR(24) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status VARCHAR(32) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','needs_approval','completed','cancelled')),
  due_at TIMESTAMPTZ,
  requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  proof_url TEXT,
  completion_note TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_tasks_restaurant
  ON restaurant_crew_tasks(restaurant_id, status, due_at NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_crew_tasks_assigned
  ON restaurant_crew_tasks(assigned_to, status, due_at NULLS LAST);

CREATE TABLE IF NOT EXISTS food_customer_favorite_items (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  menu_item_id BIGINT NOT NULL REFERENCES food_menu_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_food_customer_favorite_items_customer
  ON food_customer_favorite_items(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_inventory_availability_events (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  inventory_item_id BIGINT REFERENCES restaurant_inventory_items(id) ON DELETE SET NULL,
  menu_item_id BIGINT REFERENCES food_menu_items(id) ON DELETE SET NULL,
  previous_available BOOLEAN,
  next_available BOOLEAN NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_availability_events_restaurant
  ON restaurant_inventory_availability_events(restaurant_id, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_app_devices_updated_at') THEN
    CREATE TRIGGER trg_restaurant_app_devices_updated_at
      BEFORE UPDATE ON restaurant_app_devices
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_crew_tasks_updated_at') THEN
    CREATE TRIGGER trg_restaurant_crew_tasks_updated_at
      BEFORE UPDATE ON restaurant_crew_tasks
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
