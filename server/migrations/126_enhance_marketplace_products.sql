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
  helper_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
