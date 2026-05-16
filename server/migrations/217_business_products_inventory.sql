-- Migration 183: Products and Inventory Management
-- Full product catalog, variants, and stock tracking
-- Created: 2026-05-15

BEGIN;

-- Products
CREATE TABLE IF NOT EXISTS business_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  sku VARCHAR(100) NOT NULL,
  price_cents BIGINT NOT NULL DEFAULT 0,
  cost_cents BIGINT DEFAULT 0,
  thumbnail_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  UNIQUE(business_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_business_products_business ON business_products(business_id);
CREATE INDEX IF NOT EXISTS idx_business_products_category ON business_products(category);
CREATE INDEX IF NOT EXISTS idx_business_products_active ON business_products(is_active);
CREATE INDEX IF NOT EXISTS idx_business_products_deleted ON business_products(deleted_at);

-- Product Variants (size, color, material, etc.)
CREATE TABLE IF NOT EXISTS business_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
  variant_name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL,
  price_adjustment_cents BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_business_product_variants_product ON business_product_variants(product_id);

-- Product Inventory (stock tracking per variant)
CREATE TABLE IF NOT EXISTS business_product_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES business_product_variants(id) ON DELETE CASCADE,
  stock_quantity INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 10,
  reserved_quantity INTEGER DEFAULT 0,
  last_restocked TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_business_product_inventory_variant ON business_product_inventory(variant_id);

-- Product Gallery (images)
CREATE TABLE IF NOT EXISTS business_product_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  alt_text VARCHAR(255),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_product_gallery_product ON business_product_gallery(product_id);

-- Product Reviews and Ratings
CREATE TABLE IF NOT EXISTS business_product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES business_products(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id),
  customer_name VARCHAR(255),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  title VARCHAR(255),
  comment TEXT,
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_product_reviews_product ON business_product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_business_product_reviews_customer ON business_product_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_business_product_reviews_approved ON business_product_reviews(is_approved);

-- Stock History (audit trail for inventory changes)
CREATE TABLE IF NOT EXISTS business_product_stock_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES business_product_variants(id) ON DELETE CASCADE,
  change_type VARCHAR(50) NOT NULL CHECK (change_type IN (
    'initial', 'restock', 'sale', 'adjustment', 'damage', 'return'
  )),
  quantity_change INTEGER NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_product_stock_history_variant ON business_product_stock_history(variant_id);
CREATE INDEX IF NOT EXISTS idx_business_product_stock_history_type ON business_product_stock_history(change_type);
CREATE INDEX IF NOT EXISTS idx_business_product_stock_history_date ON business_product_stock_history(created_at DESC);

-- Low Stock Alerts
CREATE TABLE IF NOT EXISTS business_product_low_stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES business_product_variants(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  last_alerted TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(variant_id)
);

CREATE INDEX IF NOT EXISTS idx_business_product_low_stock_alerts_active ON business_product_low_stock_alerts(is_active);

COMMIT;
