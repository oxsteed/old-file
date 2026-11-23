-- Group 8 (items 351-450): restaurant owner/manager + team member operations. Additive + idempotent.
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS scheduled_slot_minutes SMALLINT NOT NULL DEFAULT 15;
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS scheduled_slot_max_orders SMALLINT;
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS pickup_area_label VARCHAR(120);
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS pickup_instructions TEXT;
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS pickup_parking_note TEXT;
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS curbside_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS substitution_policy VARCHAR(20) NOT NULL DEFAULT 'contact_customer';
ALTER TABLE restaurant_locations ADD COLUMN IF NOT EXISTS unclaimed_pickup_minutes SMALLINT NOT NULL DEFAULT 30;
DO $$ BEGIN
  ALTER TABLE restaurant_locations ADD CONSTRAINT restaurant_locations_substitution_policy_chk CHECK (substitution_policy IN ('contact_customer','substitute_similar','refund_item','cancel_order'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS pickup_code VARCHAR(6);
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS pickup_code_verified_at TIMESTAMPTZ;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS kitchen_owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS pack_checklist JSONB;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS cancel_follow_up_status VARCHAR(12);
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS cancel_follow_up_note TEXT;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS cancel_follow_up_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS cancel_follow_up_at TIMESTAMPTZ;
ALTER TABLE food_orders ADD COLUMN IF NOT EXISTS unclaimed_alerted_at TIMESTAMPTZ;

ALTER TABLE restaurant_help_requests ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'general';
ALTER TABLE restaurant_help_requests ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE restaurant_help_requests ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;
ALTER TABLE restaurant_help_requests ADD COLUMN IF NOT EXISTS location_id BIGINT;
ALTER TABLE restaurant_help_requests ADD COLUMN IF NOT EXISTS order_id BIGINT;

CREATE TABLE IF NOT EXISTS restaurant_location_special_hours (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  on_date DATE NOT NULL,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  opens_at TIME,
  closes_at TIME,
  label VARCHAR(80),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, on_date),
  CHECK (closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS restaurant_location_readiness (
  location_id BIGINT PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  launched_at TIMESTAMPTZ,
  launched_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_menu_change_log (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL,
  location_id BIGINT,
  menu_item_id BIGINT NOT NULL,
  field VARCHAR(30) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID,
  source VARCHAR(20) NOT NULL DEFAULT 'edit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_menu_change_log_item ON restaurant_menu_change_log(restaurant_id, menu_item_id, created_at DESC);

-- 360: every price/name/availability/publication change on a menu item is logged.
-- The actor comes from the transaction-local setting app.menu_actor when a
-- caller sets it; otherwise it stays NULL (recorded as "system/unknown").
CREATE OR REPLACE FUNCTION restaurant_menu_item_change_log() RETURNS trigger AS $$
DECLARE actor UUID; src TEXT;
BEGIN
  BEGIN actor := NULLIF(current_setting('app.menu_actor', true), '')::uuid; EXCEPTION WHEN others THEN actor := NULL; END;
  src := COALESCE(NULLIF(current_setting('app.menu_source', true), ''), 'edit');
  IF NEW.name IS DISTINCT FROM OLD.name THEN INSERT INTO restaurant_menu_change_log(restaurant_id, menu_item_id, field, old_value, new_value, changed_by, source) VALUES (NEW.restaurant_id, NEW.id, 'name', OLD.name, NEW.name, actor, src); END IF;
  IF NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN INSERT INTO restaurant_menu_change_log(restaurant_id, menu_item_id, field, old_value, new_value, changed_by, source) VALUES (NEW.restaurant_id, NEW.id, 'price_cents', OLD.price_cents::text, NEW.price_cents::text, actor, src); END IF;
  IF NEW.is_available IS DISTINCT FROM OLD.is_available THEN INSERT INTO restaurant_menu_change_log(restaurant_id, menu_item_id, field, old_value, new_value, changed_by, source) VALUES (NEW.restaurant_id, NEW.id, 'is_available', OLD.is_available::text, NEW.is_available::text, actor, src); END IF;
  IF NEW.publication_status IS DISTINCT FROM OLD.publication_status THEN INSERT INTO restaurant_menu_change_log(restaurant_id, menu_item_id, field, old_value, new_value, changed_by, source) VALUES (NEW.restaurant_id, NEW.id, 'publication_status', OLD.publication_status, NEW.publication_status, actor, src); END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN INSERT INTO restaurant_menu_change_log(restaurant_id, menu_item_id, field, old_value, new_value, changed_by, source) VALUES (NEW.restaurant_id, NEW.id, 'description', LEFT(OLD.description, 500), LEFT(NEW.description, 500), actor, src); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_restaurant_menu_item_change_log ON food_menu_items;
CREATE TRIGGER trg_restaurant_menu_item_change_log AFTER UPDATE ON food_menu_items FOR EACH ROW EXECUTE FUNCTION restaurant_menu_item_change_log();

CREATE OR REPLACE FUNCTION restaurant_store_override_change_log() RETURNS trigger AS $$
DECLARE actor UUID; src TEXT;
BEGIN
  BEGIN actor := NULLIF(current_setting('app.menu_actor', true), '')::uuid; EXCEPTION WHEN others THEN actor := NULL; END;
  src := COALESCE(NULLIF(current_setting('app.menu_source', true), ''), 'edit');
  IF TG_OP = 'INSERT' OR NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN
    INSERT INTO restaurant_menu_change_log(restaurant_id, location_id, menu_item_id, field, old_value, new_value, changed_by, source)
    VALUES (NEW.restaurant_id, NEW.location_id, NEW.menu_item_id, 'store_price_cents', CASE WHEN TG_OP='UPDATE' THEN OLD.price_cents::text END, NEW.price_cents::text, COALESCE(actor, NEW.updated_by), src);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.is_available IS DISTINCT FROM OLD.is_available THEN
    INSERT INTO restaurant_menu_change_log(restaurant_id, location_id, menu_item_id, field, old_value, new_value, changed_by, source)
    VALUES (NEW.restaurant_id, NEW.location_id, NEW.menu_item_id, 'store_is_available', CASE WHEN TG_OP='UPDATE' THEN OLD.is_available::text END, NEW.is_available::text, COALESCE(actor, NEW.updated_by), src);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_restaurant_store_override_change_log ON restaurant_store_menu_overrides;
CREATE TRIGGER trg_restaurant_store_override_change_log AFTER INSERT OR UPDATE ON restaurant_store_menu_overrides FOR EACH ROW EXECUTE FUNCTION restaurant_store_override_change_log();

CREATE TABLE IF NOT EXISTS restaurant_scheduled_menu_changes (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT,
  menu_item_id BIGINT NOT NULL REFERENCES food_menu_items(id) ON DELETE CASCADE,
  price_cents INTEGER CHECK (price_cents >= 0),
  is_available BOOLEAN,
  effective_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled','failed')),
  applied_at TIMESTAMPTZ,
  failure TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (price_cents IS NOT NULL OR is_available IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_sched_menu_due ON restaurant_scheduled_menu_changes(effective_at) WHERE status='pending';

CREATE TABLE IF NOT EXISTS restaurant_location_closures (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  reason VARCHAR(20) NOT NULL CHECK (reason IN ('power','water','weather','equipment','staffing','safety','other')),
  note TEXT,
  previous_status VARCHAR(30),
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reopen_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  reopened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reopened_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_location_closure_open ON restaurant_location_closures(location_id) WHERE reopened_at IS NULL;

CREATE TABLE IF NOT EXISTS restaurant_equipment_downtime (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  station_id BIGINT,
  equipment VARCHAR(120) NOT NULL,
  note TEXT,
  affected_item_ids BIGINT[] NOT NULL DEFAULT '{}',
  status VARCHAR(10) NOT NULL DEFAULT 'down' CHECK (status IN ('down','restored')),
  reopen_checks JSONB,
  reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_by UUID REFERENCES users(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_equipment_downtime_loc ON restaurant_equipment_downtime(location_id, status);

CREATE TABLE IF NOT EXISTS restaurant_order_transfers (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  from_location_id BIGINT NOT NULL,
  to_location_id BIGINT NOT NULL,
  reason TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','declined','cancelled')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_order_transfer_open ON restaurant_order_transfers(order_id) WHERE status='requested';

CREATE TABLE IF NOT EXISTS restaurant_shift_checkins (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id BIGINT,
  station_id BIGINT,
  station_assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  location_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handoff_seen_at TIMESTAMPTZ,
  readiness_ack_at TIMESTAMPTZ,
  readiness_items JSONB,
  break_started_at TIMESTAMPTZ,
  last_break_ended_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_shift_checkin_open ON restaurant_shift_checkins(restaurant_id, user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_shift_checkins_loc ON restaurant_shift_checkins(location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_stock_notices (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  menu_item_id BIGINT REFERENCES food_menu_items(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('low_stock','substitution','menu_correction')),
  note TEXT,
  substitutes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_restaurant_stock_notices_loc ON restaurant_stock_notices(location_id, status);

CREATE TABLE IF NOT EXISTS restaurant_order_issues (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT,
  order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  order_item_id BIGINT,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('missing_item','substitution','wrong_order','late')),
  detail TEXT,
  proposed_substitute VARCHAR(160),
  customer_response VARCHAR(12) CHECK (customer_response IN ('pending','accepted','declined','no_response')),
  customer_responded_at TIMESTAMPTZ,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','resolved')),
  escalated_to UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_restaurant_order_issues_order ON restaurant_order_issues(order_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_order_issues_loc ON restaurant_order_issues(restaurant_id, location_id, status);

CREATE TABLE IF NOT EXISTS restaurant_ticket_handoffs (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('owner','station','prep')),
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_station VARCHAR(80),
  to_station VARCHAR(80),
  order_item_ids BIGINT[],
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restaurant_ticket_handoffs_order ON restaurant_ticket_handoffs(order_id);

-- 417: every pickup order gets a 4-digit code the customer shows at handoff.
CREATE OR REPLACE FUNCTION food_orders_pickup_code() RETURNS trigger AS $$
BEGIN
  IF NEW.pickup_code IS NULL AND NEW.fulfillment_type = 'pickup' THEN
    NEW.pickup_code := lpad((floor(random() * 10000))::int::text, 4, '0');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_food_orders_pickup_code ON food_orders;
CREATE TRIGGER trg_food_orders_pickup_code BEFORE INSERT ON food_orders FOR EACH ROW EXECUTE FUNCTION food_orders_pickup_code();
