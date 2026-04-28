-- Migration 125: Skill-Based Product Marketplace
-- Enables helpers to browse products by skill, build carts, and share with customers
-- Tables: marketplace products, carts, sharing, affiliate tracking

-- Core Products Table
CREATE TABLE IF NOT EXISTS marketplace_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(20) NOT NULL DEFAULT 'internal', -- 'homedepot', 'internal'
  external_id VARCHAR(100), -- Home Depot product ID
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  sku VARCHAR(50),
  upc VARCHAR(20),
  price_cents INTEGER, -- current price in cents
  currency VARCHAR(3) DEFAULT 'USD',
  affiliate_url TEXT, -- Home Depot affiliate link
  product_image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_available BOOLEAN DEFAULT TRUE,
  home_depot_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marketplace_products_source_external_id
  ON marketplace_products(source, external_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_is_active
  ON marketplace_products(is_active);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_category
  ON marketplace_products(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_name_gin
  ON marketplace_products USING GIN(to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- Product to Skills Mapping (Many-to-Many)
CREATE TABLE IF NOT EXISTS marketplace_product_skills (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  skill_id BIGINT NOT NULL REFERENCES skills_lookup(id) ON DELETE CASCADE,
  relevance_score SMALLINT DEFAULT 50, -- 0-100 score
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_product_skills_skill_id
  ON marketplace_product_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_product_skills_product_id
  ON marketplace_product_skills(product_id);

-- Shopping Carts
CREATE TABLE IF NOT EXISTS shopping_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  name VARCHAR(255),
  description TEXT,
  is_template BOOLEAN DEFAULT FALSE, -- marked as reusable template
  subtotal_cents INTEGER DEFAULT 0,
  tax_cents INTEGER DEFAULT 0,
  total_cents INTEGER DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(20) DEFAULT 'draft', -- draft, shared, approved, purchased
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shopping_carts_helper_id
  ON shopping_carts(helper_id);
CREATE INDEX IF NOT EXISTS idx_shopping_carts_job_id
  ON shopping_carts(job_id);
CREATE INDEX IF NOT EXISTS idx_shopping_carts_helper_template
  ON shopping_carts(helper_id) WHERE is_template = TRUE;
CREATE INDEX IF NOT EXISTS idx_shopping_carts_status
  ON shopping_carts(status);

-- Shopping Cart Items
CREATE TABLE IF NOT EXISTS shopping_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE RESTRICT,
  quantity SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER, -- price at time of addition
  notes TEXT,
  sort_order SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id
  ON shopping_cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id
  ON shopping_cart_items(product_id);

-- Shared Carts (with tokens for public access)
CREATE TABLE IF NOT EXISTS shared_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  share_token VARCHAR(64) NOT NULL UNIQUE, -- URL-safe token
  shared_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  customer_id BIGINT REFERENCES users(id) ON DELETE SET NULL, -- if shared with specific customer
  can_modify BOOLEAN DEFAULT TRUE, -- customer can add/remove items
  expires_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shared_carts_token
  ON shared_carts(share_token);
CREATE INDEX IF NOT EXISTS idx_shared_carts_cart_id
  ON shared_carts(cart_id);
CREATE INDEX IF NOT EXISTS idx_shared_carts_customer_id
  ON shared_carts(customer_id);
CREATE INDEX IF NOT EXISTS idx_shared_carts_shared_by
  ON shared_carts(shared_by);

-- Shared Cart Views (Analytics)
CREATE TABLE IF NOT EXISTS shared_cart_views (
  id SERIAL PRIMARY KEY,
  shared_cart_id UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,
  viewed_by_id BIGINT REFERENCES users(id) ON DELETE SET NULL, -- null for guests
  view_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  user_agent TEXT,
  ip_hash VARCHAR(64),
  action VARCHAR(30), -- view, add_item, remove_item, modify, approve
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shared_cart_views_shared_cart
  ON shared_cart_views(shared_cart_id, view_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_shared_cart_views_viewed_by
  ON shared_cart_views(viewed_by_id);

-- Cart Approvals (Customer approval workflow)
CREATE TABLE IF NOT EXISTS cart_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  shared_cart_id UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  customer_notes TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cart_approvals_customer
  ON cart_approvals(customer_id);
CREATE INDEX IF NOT EXISTS idx_cart_approvals_cart
  ON cart_approvals(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_approvals_shared_cart
  ON cart_approvals(shared_cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_approvals_status
  ON cart_approvals(status);

-- Affiliate Links Log (track conversions)
CREATE TABLE IF NOT EXISTS affiliate_links_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_cart_id UUID REFERENCES shared_carts(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE RESTRICT,
  affiliate_url TEXT NOT NULL,
  clicks BIGINT DEFAULT 0,
  conversions BIGINT DEFAULT 0,
  commission_cents INTEGER DEFAULT 0,
  commission_status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, paid
  home_depot_order_id VARCHAR(100),
  clicked_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_links_shared_cart
  ON affiliate_links_log(shared_cart_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_product
  ON affiliate_links_log(product_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_status
  ON affiliate_links_log(commission_status);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_order_id
  ON affiliate_links_log(home_depot_order_id);
