
-- >>> BEGIN: 125_marketplace_products_carts_sharing.sql <<<
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

CREATE INDEX IF NOT EXISTS idx_marketplace_products_source_external_id ON marketplace_products(source, external_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_is_active ON marketplace_products(is_active);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_category ON marketplace_products(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_name_gin ON marketplace_products USING GIN(to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- Product to Skills Mapping (Many-to-Many)
CREATE TABLE IF NOT EXISTS marketplace_product_skills (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  skill_id BIGINT NOT NULL REFERENCES skills_lookup(id) ON DELETE CASCADE,
  relevance_score SMALLINT DEFAULT 50, -- 0-100 score
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_product_skills_skill_id ON marketplace_product_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_product_skills_product_id ON marketplace_product_skills(product_id);

-- Shopping Carts
-- Handle partial migration: drop bad FK if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shopping_carts') THEN
    ALTER TABLE shopping_carts DROP CONSTRAINT IF EXISTS shopping_carts_helper_id_fkey;
    -- Clean up rows with invalid/NULL helper_id values
    DELETE FROM shopping_carts sc
      WHERE helper_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id::text = sc.helper_id::text);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shopping_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_shopping_carts_helper_id ON shopping_carts(helper_id);
CREATE INDEX IF NOT EXISTS idx_shopping_carts_job_id ON shopping_carts(job_id);
CREATE INDEX IF NOT EXISTS idx_shopping_carts_helper_template ON shopping_carts(helper_id) WHERE is_template = TRUE;
CREATE INDEX IF NOT EXISTS idx_shopping_carts_status ON shopping_carts(status);

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

CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON shopping_cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON shopping_cart_items(product_id);

-- Shared Carts (with tokens for public access)
CREATE TABLE IF NOT EXISTS shared_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  share_token VARCHAR(64) NOT NULL UNIQUE, -- URL-safe token
  shared_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL, -- if shared with specific customer
  can_modify BOOLEAN DEFAULT TRUE, -- customer can add/remove items
  expires_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shared_carts_token ON shared_carts(share_token);
CREATE INDEX IF NOT EXISTS idx_shared_carts_cart_id ON shared_carts(cart_id);
CREATE INDEX IF NOT EXISTS idx_shared_carts_customer_id ON shared_carts(customer_id);
CREATE INDEX IF NOT EXISTS idx_shared_carts_shared_by ON shared_carts(shared_by);

-- Shared Cart Views (Analytics)
CREATE TABLE IF NOT EXISTS shared_cart_views (
  id SERIAL PRIMARY KEY,
  shared_cart_id UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,
  viewed_by_id UUID REFERENCES users(id) ON DELETE SET NULL, -- null for guests
  view_timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  user_agent TEXT,
  ip_hash VARCHAR(64),
  action VARCHAR(30), -- view, add_item, remove_item, modify, approve
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shared_cart_views_shared_cart ON shared_cart_views(shared_cart_id, view_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_shared_cart_views_viewed_by ON shared_cart_views(viewed_by_id);

-- Cart Approvals (Customer approval workflow)
CREATE TABLE IF NOT EXISTS cart_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
  shared_cart_id UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  customer_notes TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cart_approvals_customer ON cart_approvals(customer_id);
CREATE INDEX IF NOT EXISTS idx_cart_approvals_cart ON cart_approvals(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_approvals_shared_cart ON cart_approvals(shared_cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_approvals_status ON cart_approvals(status);

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

CREATE INDEX IF NOT EXISTS idx_affiliate_links_shared_cart ON affiliate_links_log(shared_cart_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_product ON affiliate_links_log(product_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_status ON affiliate_links_log(commission_status);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_order_id ON affiliate_links_log(home_depot_order_id);

-- >>> END: 125_marketplace_products_carts_sharing.sql <<<

-- >>> BEGIN: 126_enhance_marketplace_products.sql <<<
-- Migration 126: Enhanced Marketplace Products Analytics & Discovery
-- Adds ratings, cart analytics, product reviews, and frequently-bought-together recommendations

-- Add analytics and rating columns to marketplace_products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'avg_rating'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN avg_rating NUMERIC(2,1);
    ALTER TABLE marketplace_products ADD CONSTRAINT chk_avg_rating
      CHECK (avg_rating >= 0 AND avg_rating <= 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'rating_count'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN rating_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'in_carts_count'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN in_carts_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'helper_review_count'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN helper_review_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create product reviews table (helper reviews for products they've used)
CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  helpful_count INTEGER DEFAULT 0,
  is_verified_purchase BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, helper_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id
  ON product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_helper_id
  ON product_reviews(helper_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_rating
  ON product_reviews(rating DESC);
CREATE INDEX IF NOT EXISTS idx_product_reviews_created
  ON product_reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_reviews_helpful
  ON product_reviews(helpful_count DESC);

-- Create frequently bought together junction table
CREATE TABLE IF NOT EXISTS frequently_bought_together (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  related_product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  frequency INTEGER DEFAULT 1,
  co_purchase_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, related_product_id),
  CHECK (product_id != related_product_id)
);

CREATE INDEX IF NOT EXISTS idx_fbt_product_id
  ON frequently_bought_together(product_id);
CREATE INDEX IF NOT EXISTS idx_fbt_related_product_id
  ON frequently_bought_together(related_product_id);
CREATE INDEX IF NOT EXISTS idx_fbt_frequency_desc
  ON frequently_bought_together(frequency DESC);
CREATE INDEX IF NOT EXISTS idx_fbt_co_purchase_count
  ON frequently_bought_together(co_purchase_count DESC);

-- Add indexes for discovery and filtering on marketplace_products
CREATE INDEX IF NOT EXISTS idx_marketplace_products_avg_rating_desc
  ON marketplace_products(avg_rating DESC NULLS LAST)
  WHERE is_active = TRUE AND is_available = TRUE;

CREATE INDEX IF NOT EXISTS idx_marketplace_products_in_carts_desc
  ON marketplace_products(in_carts_count DESC)
  WHERE is_active = TRUE AND is_available = TRUE;

CREATE INDEX IF NOT EXISTS idx_marketplace_products_rating_count_desc
  ON marketplace_products(rating_count DESC)
  WHERE is_active = TRUE AND is_available = TRUE;

CREATE INDEX IF NOT EXISTS idx_marketplace_products_active_available
  ON marketplace_products(is_active, is_available)
  WHERE is_active = TRUE AND is_available = TRUE;

CREATE INDEX IF NOT EXISTS idx_marketplace_products_category_active
  ON marketplace_products(category, is_active, is_available)
  WHERE is_active = TRUE AND is_available = TRUE;

-- Composite index for common browse queries (category + availability + sorting)
CREATE INDEX IF NOT EXISTS idx_marketplace_products_browse
  ON marketplace_products(category, avg_rating DESC NULLS LAST, in_carts_count DESC)
  WHERE is_active = TRUE AND is_available = TRUE;

-- >>> END: 126_enhance_marketplace_products.sql <<<

-- >>> BEGIN: 127_add_pending_registrations_address_and_role_fields.sql <<<
-- ===============================================================
-- Migration 127: Add missing address and role fields to pending_registrations
-- Adds columns that authController.startRegistration() expects but were missing
-- ===============================================================

BEGIN;

-- Add missing address fields to pending_registrations
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS state VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NULL,
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS referral_ref VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL DEFAULT now();

-- Create index on updated_at for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_pending_reg_updated ON pending_registrations(updated_at);

COMMIT;

-- ===============================================================
-- END OF MIGRATION 127
-- ===============================================================

-- >>> END: 127_add_pending_registrations_address_and_role_fields.sql <<<

-- >>> BEGIN: 128_add_email_unique_to_pending_registrations.sql <<<
-- ===============================================================
-- Migration 128: Add UNIQUE constraint on email to pending_registrations
-- The INSERT ON CONFLICT (email) clause requires a unique index on email
-- ===============================================================

BEGIN;

-- Add unique constraint on email for pending registrations
-- This allows ON CONFLICT (email) DO UPDATE to work properly
-- when a user retries registration with the same email
ALTER TABLE pending_registrations
  ADD CONSTRAINT pending_registrations_email_unique UNIQUE (email);

COMMIT;

-- ===============================================================
-- END OF MIGRATION 128
-- ===============================================================

-- >>> END: 128_add_email_unique_to_pending_registrations.sql <<<

-- >>> BEGIN: 129_marketplace_orders_transactions.sql <<<
-- Product marketplace orders and transactions
CREATE TABLE IF NOT EXISTS marketplace_orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cart_id UUID REFERENCES shopping_carts(id) ON DELETE SET NULL,
  total_cents BIGINT NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  tax_cents BIGINT DEFAULT 0,
  shipping_cents BIGINT DEFAULT 0,
  discount_cents BIGINT DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, paid, processing, completed, cancelled, refunded
  payment_method VARCHAR(50), -- card, bank_transfer, etc.
  shipping_address JSONB, -- {street, city, state, zip, country}
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded'))
);

CREATE INDEX idx_marketplace_orders_customer_id ON marketplace_orders(customer_id);
CREATE INDEX idx_marketplace_orders_status ON marketplace_orders(status);
CREATE INDEX idx_marketplace_orders_created_at ON marketplace_orders(created_at DESC);

-- Order line items
CREATE TABLE IF NOT EXISTS marketplace_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE RESTRICT,
  quantity INT NOT NULL DEFAULT 1,
  unit_price_cents BIGINT NOT NULL,
  total_price_cents BIGINT NOT NULL,
  affiliate_link_id UUID REFERENCES affiliate_links_log(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT positive_quantity CHECK (quantity > 0),
  CONSTRAINT positive_price CHECK (unit_price_cents > 0)
);

CREATE INDEX idx_marketplace_order_items_order_id ON marketplace_order_items(order_id);
CREATE INDEX idx_marketplace_order_items_product_id ON marketplace_order_items(product_id);

-- Payment transactions (Stripe PaymentIntent records)
CREATE TABLE IF NOT EXISTS marketplace_transactions (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  payment_intent_id VARCHAR(255) NOT NULL UNIQUE,
  amount_cents BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  status VARCHAR(50) NOT NULL, -- requires_action, requires_confirmation, requires_payment_method, processing, succeeded, canceled
  client_secret VARCHAR(255),
  receipt_email VARCHAR(255),
  last_payment_error JSONB,
  metadata JSONB, -- for storing custom data
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_marketplace_transactions_order_id ON marketplace_transactions(order_id);
CREATE INDEX idx_marketplace_transactions_payment_intent_id ON marketplace_transactions(payment_intent_id);
CREATE INDEX idx_marketplace_transactions_status ON marketplace_transactions(status);

-- Affiliate link click tracking (enhanced from affiliate_links_log)
ALTER TABLE affiliate_links_log ADD COLUMN IF NOT EXISTS last_click_at TIMESTAMP;
ALTER TABLE affiliate_links_log ADD COLUMN IF NOT EXISTS pending_conversions INT DEFAULT 0;
ALTER TABLE affiliate_links_log ADD COLUMN IF NOT EXISTS confirmed_conversions INT DEFAULT 0;
ALTER TABLE affiliate_links_log ADD COLUMN IF NOT EXISTS payout_id BIGINT;

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id BIGSERIAL PRIMARY KEY,
  affiliate_link_id UUID NOT NULL REFERENCES affiliate_links_log(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  referrer VARCHAR(500),
  user_agent VARCHAR(500),
  ip_address VARCHAR(45),
  session_id VARCHAR(255),
  converted_to_order_id BIGINT REFERENCES marketplace_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_affiliate_clicks_link_id ON affiliate_clicks(affiliate_link_id);
CREATE INDEX idx_affiliate_clicks_user_id ON affiliate_clicks(user_id);
CREATE INDEX idx_affiliate_clicks_created_at ON affiliate_clicks(created_at DESC);

-- >>> END: 129_marketplace_orders_transactions.sql <<<

-- >>> BEGIN: 130_api_products_system.sql <<<
-- API Products for digital/SaaS product sales
CREATE TABLE IF NOT EXISTS api_products (
  id BIGSERIAL PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- api, saas, digital, subscription, etc.
  pricing_type VARCHAR(50) NOT NULL, -- one_time, recurring, tiered
  price_cents BIGINT,
  monthly_price_cents BIGINT, -- for recurring
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, published, archived
  api_key_prefix VARCHAR(20), -- first 8 chars of key for display
  webhook_url VARCHAR(500), -- for event notifications
  max_requests_per_month BIGINT, -- rate limiting
  documentation_url VARCHAR(500),
  support_email VARCHAR(255),
  terms_url VARCHAR(500),
  rating DECIMAL(3,2) DEFAULT 0,
  review_count INT DEFAULT 0,
  monthly_revenue_cents BIGINT DEFAULT 0,
  active_subscriptions INT DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP
);

CREATE INDEX idx_api_products_creator_id ON api_products(creator_id);
CREATE INDEX idx_api_products_status ON api_products(status);
CREATE INDEX idx_api_products_created_at ON api_products(created_at DESC);

-- API product keys (for authentication)
CREATE TABLE IF NOT EXISTS api_product_keys (
  id BIGSERIAL PRIMARY KEY,
  api_product_id BIGINT NOT NULL REFERENCES api_products(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL, -- for display
  usage_limit INT, -- null = unlimited
  requests_this_month INT DEFAULT 0,
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT not_revoked_and_used CHECK (revoked_at IS NULL OR last_used_at IS NULL)
);

CREATE INDEX idx_api_product_keys_api_product_id ON api_product_keys(api_product_id);
CREATE INDEX idx_api_product_keys_customer_id ON api_product_keys(customer_id);
CREATE INDEX idx_api_product_keys_key_hash ON api_product_keys(key_hash);

-- API product subscriptions
CREATE TABLE IF NOT EXISTS api_product_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  api_product_id BIGINT NOT NULL REFERENCES api_products(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id BIGINT REFERENCES marketplace_orders(id) ON DELETE SET NULL,
  subscription_id VARCHAR(255), -- Stripe subscription ID
  status VARCHAR(50) NOT NULL, -- active, paused, cancelled, expired
  billing_cycle_anchor TIMESTAMP,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancellation_reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_product_subscriptions_api_product_id ON api_product_subscriptions(api_product_id);
CREATE INDEX idx_api_product_subscriptions_customer_id ON api_product_subscriptions(customer_id);
CREATE INDEX idx_api_product_subscriptions_status ON api_product_subscriptions(status);
CREATE INDEX idx_api_product_subscriptions_unique ON api_product_subscriptions(api_product_id, customer_id) WHERE status != 'cancelled';

-- API usage logs for analytics
CREATE TABLE IF NOT EXISTS api_product_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  api_product_id BIGINT NOT NULL REFERENCES api_products(id) ON DELETE CASCADE,
  key_id BIGINT NOT NULL REFERENCES api_product_keys(id) ON DELETE CASCADE,
  endpoint VARCHAR(255),
  method VARCHAR(10), -- GET, POST, etc.
  status_code INT,
  response_time_ms INT,
  request_size_bytes INT,
  response_size_bytes INT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_product_usage_logs_api_product_id ON api_product_usage_logs(api_product_id);
CREATE INDEX idx_api_product_usage_logs_created_at ON api_product_usage_logs(created_at DESC);

-- >>> END: 130_api_products_system.sql <<<
