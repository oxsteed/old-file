-- VULN #15 FIX: Prevent fake and collusive reviews

ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS verified_purchase BOOLEAN DEFAULT FALSE;
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS reviewer_ip_address VARCHAR(45);
ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS reviewer_user_agent TEXT;

-- Only verified purchasers can review (or admins can override)
CREATE OR REPLACE FUNCTION validate_review_eligibility()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if reviewer actually purchased the product
  IF NOT EXISTS(
    SELECT 1 FROM marketplace_orders mo
    JOIN marketplace_order_items moi ON mo.id = moi.order_id
    WHERE moi.product_id = NEW.product_id
      AND mo.customer_id = NEW.reviewer_id
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
ALTER TABLE product_reviews ADD CONSTRAINT IF NOT EXISTS uq_reviewer_product
  UNIQUE(reviewer_id, product_id);

-- Index for fraud detection (multiple reviews from same IP)
CREATE INDEX IF NOT EXISTS idx_reviews_ip ON product_reviews(reviewer_ip_address);
