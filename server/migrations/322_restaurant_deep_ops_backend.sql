-- Migration 322: Restaurant deep operations backend.
-- Fills second-pass operational gaps for POS, Kitchen, Runner, and Crew apps.

ALTER TABLE food_orders
  ADD COLUMN IF NOT EXISTS pos_ticket_state VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (pos_ticket_state IN ('open','held','voided','refunded','closed')),
  ADD COLUMN IF NOT EXISTS pos_parent_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pos_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_food_orders_pos_state
  ON food_orders (restaurant_id, pos_ticket_state, created_at DESC);

ALTER TABLE restaurant_runner_tasks
  ADD COLUMN IF NOT EXISTS pickup_eta_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_eta_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS restaurant_pos_payments (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  food_order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  shift_id BIGINT REFERENCES restaurant_pos_shifts(id) ON DELETE SET NULL,
  payment_type VARCHAR(24) NOT NULL
    CHECK (payment_type IN ('cash','card','external','gift_card','comp','refund')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded','pending','captured','failed','refunded','voided')),
  reference VARCHAR(160),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_payments_order
  ON restaurant_pos_payments(food_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_pos_payments_shift
  ON restaurant_pos_payments(restaurant_id, shift_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_staff_pins (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  staff_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  staff_label VARCHAR(160),
  pin_hash TEXT NOT NULL,
  role_label VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, staff_user_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_staff_pins_restaurant
  ON restaurant_staff_pins(restaurant_id, is_active, staff_label);

CREATE TABLE IF NOT EXISTS restaurant_runner_location_pings (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT REFERENCES restaurant_runner_tasks(id) ON DELETE SET NULL,
  runner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy_meters DOUBLE PRECISION,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_runner_location_pings_task
  ON restaurant_runner_location_pings(task_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_runner_location_pings_runner
  ON restaurant_runner_location_pings(runner_user_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_crew_task_comments (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES restaurant_crew_tasks(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_crew_task_comments_task
  ON restaurant_crew_task_comments(task_id, created_at ASC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restaurant_staff_pins_updated_at') THEN
    CREATE TRIGGER trg_restaurant_staff_pins_updated_at
      BEFORE UPDATE ON restaurant_staff_pins
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
