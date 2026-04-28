-- Migration 054: Helper Products
-- Helpers can list products (food, supplies, gear, other) on their profile.
-- OxSteed plays no verification role — self-declared, same as tools.

CREATE TABLE IF NOT EXISTS helper_products (
  id           SERIAL PRIMARY KEY,
  helper_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL CHECK (price_cents > 0),
  category     VARCHAR(50) NOT NULL DEFAULT 'food'
                 CHECK (category IN ('food', 'supply', 'gear', 'other')),
  image_url    TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_helper_products_helper ON helper_products(helper_id);
CREATE INDEX IF NOT EXISTS idx_helper_products_category ON helper_products(category);
CREATE INDEX IF NOT EXISTS idx_helper_products_available ON helper_products(helper_id, is_available);

-- Also add food skills and licenses to skills_lookup
INSERT INTO skills_lookup (name, category) VALUES
  ('Food Delivery',                  'Food & Beverage'),
  ('Meal Prep & Delivery',           'Food & Beverage'),
  ('Home-Cooked Meal Service',       'Food & Beverage'),
  ('Catering (Small Events)',        'Food & Beverage'),
  ('Grocery & Errand Delivery',      'Food & Beverage'),
  ('Baked Goods Delivery',           'Food & Beverage'),
  ('Beverage & Drinks Delivery',     'Food & Beverage')
ON CONFLICT (name) DO NOTHING;
