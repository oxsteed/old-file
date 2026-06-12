-- Migration 305: OxSteed Food restaurant ordering foundation.
-- Adds a separate restaurant ordering domain on the same OxSteed backend:
-- global restaurant onboarding, menu/catalog management, online/in-store
-- ordering, kitchen queue projection, and in-store kiosk/tablet ordering.

CREATE TABLE IF NOT EXISTS food_restaurants (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug VARCHAR(140) UNIQUE,
  display_name VARCHAR(160) NOT NULL,
  cuisine_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  description TEXT,
  phone VARCHAR(40),
  website VARCHAR(255),
  cover_photo_url TEXT,
  logo_url TEXT,
  address_street VARCHAR(255),
  address_city VARCHAR(120),
  address_state VARCHAR(120),
  address_zip VARCHAR(40),
  address_country CHAR(2) NOT NULL DEFAULT 'US',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  fulfillment_modes TEXT[] NOT NULL DEFAULT ARRAY['pickup','dine_in','kiosk']::TEXT[],
  accepts_online_orders BOOLEAN NOT NULL DEFAULT TRUE,
  accepts_in_store_orders BOOLEAN NOT NULL DEFAULT TRUE,
  kitchen_display_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'suspended')),
  prep_time_min INTEGER NOT NULL DEFAULT 15 CHECK (prep_time_min >= 0),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_restaurants_business ON food_restaurants(business_id);
CREATE INDEX IF NOT EXISTS idx_food_restaurants_owner ON food_restaurants(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_food_restaurants_status_country ON food_restaurants(status, address_country);
CREATE INDEX IF NOT EXISTS idx_food_restaurants_geo ON food_restaurants(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_food_restaurants_cuisine ON food_restaurants USING GIN(cuisine_tags);

CREATE TABLE IF NOT EXISTS food_menu_categories (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_menu_categories_restaurant
  ON food_menu_categories(restaurant_id, sort_order);

CREATE TABLE IF NOT EXISTS food_menu_items (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES food_menu_categories(id) ON DELETE SET NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  image_url TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  allergens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  nutrition JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_menu_items_restaurant
  ON food_menu_items(restaurant_id, is_available, sort_order);
CREATE INDEX IF NOT EXISTS idx_food_menu_items_category
  ON food_menu_items(category_id, sort_order);

CREATE TABLE IF NOT EXISTS food_modifier_groups (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  menu_item_id BIGINT NOT NULL REFERENCES food_menu_items(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  min_select INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select INTEGER NOT NULL DEFAULT 1 CHECK (max_select >= 0),
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_modifier_groups_item
  ON food_modifier_groups(menu_item_id, sort_order);

CREATE TABLE IF NOT EXISTS food_modifiers (
  id BIGSERIAL PRIMARY KEY,
  modifier_group_id BIGINT NOT NULL REFERENCES food_modifier_groups(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_modifiers_group
  ON food_modifiers(modifier_group_id, sort_order);

CREATE TABLE IF NOT EXISTS food_orders (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE RESTRICT,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_name VARCHAR(140),
  guest_phone VARCHAR(40),
  guest_email VARCHAR(255),
  order_source VARCHAR(24) NOT NULL DEFAULT 'mobile'
    CHECK (order_source IN ('mobile', 'web', 'kiosk', 'counter', 'tablet')),
  fulfillment_type VARCHAR(24) NOT NULL DEFAULT 'pickup'
    CHECK (fulfillment_type IN ('pickup', 'dine_in', 'delivery', 'kiosk')),
  status VARCHAR(24) NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'accepted', 'preparing', 'ready', 'completed', 'cancelled', 'refunded')),
  payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'requires_payment', 'paid', 'failed', 'refunded')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tip_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  table_label VARCHAR(80),
  queue_number INTEGER NOT NULL,
  promised_at TIMESTAMPTZ,
  stripe_payment_intent_id VARCHAR(255),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_food_orders_restaurant_status
  ON food_orders(restaurant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_food_orders_customer
  ON food_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_orders_queue_lookup
  ON food_orders(restaurant_id, created_at, queue_number);

CREATE TABLE IF NOT EXISTS food_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
  menu_item_id BIGINT REFERENCES food_menu_items(id) ON DELETE SET NULL,
  item_name VARCHAR(160) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  modifier_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (modifier_total_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  special_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_order_items_order
  ON food_order_items(order_id);

CREATE TABLE IF NOT EXISTS food_order_item_modifiers (
  id BIGSERIAL PRIMARY KEY,
  order_item_id BIGINT NOT NULL REFERENCES food_order_items(id) ON DELETE CASCADE,
  modifier_id BIGINT REFERENCES food_modifiers(id) ON DELETE SET NULL,
  modifier_name VARCHAR(120) NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_order_item_modifiers_item
  ON food_order_item_modifiers(order_item_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_restaurants_updated_at') THEN
    CREATE TRIGGER trg_food_restaurants_updated_at
      BEFORE UPDATE ON food_restaurants
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_menu_categories_updated_at') THEN
    CREATE TRIGGER trg_food_menu_categories_updated_at
      BEFORE UPDATE ON food_menu_categories
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_menu_items_updated_at') THEN
    CREATE TRIGGER trg_food_menu_items_updated_at
      BEFORE UPDATE ON food_menu_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_orders_updated_at') THEN
    CREATE TRIGGER trg_food_orders_updated_at
      BEFORE UPDATE ON food_orders
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
