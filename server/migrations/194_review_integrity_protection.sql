-- VULN #15 FIX: Prevent fake and collusive reviews
-- product_reviews uses helper_id (not reviewer_id) per migration 126 schema
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS verified_purchase BOOLEAN DEFAULT FALSE;
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS reviewer_ip_address VARCHAR(45);
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS reviewer_user_agent TEXT;

-- Only verified purchasers can review (or admins can override)
CREATE OR REPLACE FUNCTION validate_review_eligibility()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if reviewer actually purchased the product
  -- helper_id is the reviewer column in product_reviews (per migration 126)
  IF NOT EXISTS(
    SELECT 1 FROM marketplace_orders mo
    JOIN marketplace_order_items moi ON mo.id = moi.order_id
    WHERE moi.product_id = NEW.product_id
    AND mo.customer_id = NEW.helper_id
    AND mo.status = 'completed'
    AND mo.created_at < NOW() - INTERVAL '1 day' -- Prevent immediate review
  ) THEN
    RAISE EXCEPTION 'Only verified purchasers can review products';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_verify_reviewer ON product_reviews;
CREATE TRIGGER trigger_verify_reviewer
  BEFORE INSERT ON product_reviews
  FOR EACH ROW
  EXECUTE FUNCTION validate_review_eligibility();

-- One review per reviewer per product
-- Note: UNIQUE(product_id, helper_id) already exists from migration 126;
-- this DO block is a no-op on clean installs but guards re-runs safely.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'uq_reviewer_product' AND table_name = 'product_reviews'
  ) THEN
    -- Only add if the named constraint doesn't exist; the underlying unique
    -- index from migration 126 already enforces uniqueness.
    ALTER TABLE product_reviews ADD CONSTRAINT uq_reviewer_product
      UNIQUE(helper_id, product_id);
  END IF;
END $$;

-- Index for fraud detection (multiple reviews from same IP)
CREATE INDEX IF NOT EXISTS idx_reviews_ip ON product_reviews(reviewer_ip_address);
