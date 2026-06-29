-- Migration 358: Customer-facing restaurant contact and reporting.
-- Separates normal customer-to-restaurant messages from trust/support reports
-- so the mobile app can route Message, Report, and Ask Support differently.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS food_restaurant_customer_messages (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'read', 'replied', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_restaurant_customer_messages_restaurant
  ON food_restaurant_customer_messages(restaurant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_restaurant_customer_messages_customer
  ON food_restaurant_customer_messages(customer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS food_restaurant_reports (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(40) NOT NULL
    CHECK (reason IN (
      'menu_inaccurate',
      'wrong_hours_location',
      'food_safety',
      'fraud',
      'inappropriate',
      'order_issue',
      'other'
    )),
  description TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_restaurant_reports_restaurant
  ON food_restaurant_reports(restaurant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_restaurant_reports_reporter
  ON food_restaurant_reports(reporter_user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_restaurant_customer_messages_updated_at') THEN
    CREATE TRIGGER trg_food_restaurant_customer_messages_updated_at
      BEFORE UPDATE ON food_restaurant_customer_messages
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_food_restaurant_reports_updated_at') THEN
    CREATE TRIGGER trg_food_restaurant_reports_updated_at
      BEFORE UPDATE ON food_restaurant_reports
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
