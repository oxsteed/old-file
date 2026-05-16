-- Migration 184: Product Dynamic Pricing
-- Volume-based discounts, promotions, bundles, and pricing rules
-- Created: 2026-05-15

BEGIN;

-- Product Pricing Rules (dynamic pricing)
CREATE TABLE IF NOT EXISTS product_pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_name VARCHAR(200) NOT NULL,
  rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN (
    'volume', 'promotion', 'bundle', 'segment', 'seasonal'
  )),
  description TEXT,
  priority INTEGER DEFAULT 50 CHECK (priority >= 1 AND priority <= 100),
  is_active BOOLEAN DEFAULT true,
  applies_to VARCHAR(50) NOT NULL CHECK (applies_to IN ('product', 'category', 'all')),
  applies_to_id UUID,
  conditions_json JSONB,
  pricing_adjustment JSONB NOT NULL,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_pricing_rules_business ON product_pricing_rules(business_id);
CREATE INDEX IF NOT EXISTS idx_product_pricing_rules_active ON product_pricing_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_product_pricing_rules_priority ON product_pricing_rules(priority);
CREATE INDEX IF NOT EXISTS idx_product_pricing_rules_applies_to ON product_pricing_rules(applies_to);

-- Product Promotions (time-limited sales)
CREATE TABLE IF NOT EXISTS product_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  promotion_name VARCHAR(200) NOT NULL,
  description TEXT,
  discount_type VARCHAR(50) NOT NULL CHECK (discount_type IN ('percentage', 'fixed', 'bogo')),
  discount_value DECIMAL(10, 2),
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  products_json JSONB,
  categories_json JSONB,
  minimum_purchase_cents BIGINT,
  maximum_uses INTEGER,
  uses_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_promotions_business ON product_promotions(business_id);
CREATE INDEX IF NOT EXISTS idx_product_promotions_active ON product_promotions(is_active);
CREATE INDEX IF NOT EXISTS idx_product_promotions_dates ON product_promotions(start_date, end_date);

-- Product Bundles (multi-product deals)
CREATE TABLE IF NOT EXISTS product_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bundle_name VARCHAR(200) NOT NULL,
  description TEXT,
  bundle_price_cents BIGINT,
  discount_percent DECIMAL(5, 2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_bundles_business ON product_bundles(business_id);
CREATE INDEX IF NOT EXISTS idx_product_bundles_active ON product_bundles(is_active);

-- Bundle Products (items in a bundle)
CREATE TABLE IF NOT EXISTS product_bundle_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(bundle_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_bundle_items_bundle ON product_bundle_items(bundle_id);
CREATE INDEX IF NOT EXISTS idx_product_bundle_items_product ON product_bundle_items(product_id);

-- Bulk Pricing Tiers (volume-based pricing)
CREATE TABLE IF NOT EXISTS product_bulk_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
  min_quantity INTEGER NOT NULL,
  discount_percent DECIMAL(5, 2),
  discount_fixed_cents BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_id, min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_product_bulk_tiers_product ON product_bulk_tiers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_bulk_tiers_min_qty ON product_bulk_tiers(min_quantity);

-- Promotional Codes
CREATE TABLE IF NOT EXISTS product_promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  discount_type VARCHAR(50) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10, 2) NOT NULL,
  min_purchase_cents BIGINT,
  max_uses INTEGER,
  uses_count INTEGER DEFAULT 0,
  eligible_products JSONB,
  eligible_categories JSONB,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_promo_codes_business ON product_promo_codes(business_id);
CREATE INDEX IF NOT EXISTS idx_product_promo_codes_code ON product_promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_product_promo_codes_active ON product_promo_codes(is_active);

-- Promo Code Usage (audit trail)
CREATE TABLE IF NOT EXISTS product_promo_code_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES product_promo_codes(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id),
  order_id BIGINT,
  discount_amount_cents BIGINT,
  used_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_promo_code_usage_code ON product_promo_code_usage(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_product_promo_code_usage_customer ON product_promo_code_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_product_promo_code_usage_date ON product_promo_code_usage(used_at DESC);

-- Pricing History (audit trail)
CREATE TABLE IF NOT EXISTS product_pricing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
  old_price_cents BIGINT,
  new_price_cents BIGINT,
  change_reason VARCHAR(255),
  changed_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_pricing_history_product ON product_pricing_history(product_id);
CREATE INDEX IF NOT EXISTS idx_product_pricing_history_date ON product_pricing_history(created_at DESC);

COMMIT;
