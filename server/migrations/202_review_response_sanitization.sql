-- VULN #28 FIX: Sanitize review responses from sellers/admins

ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS seller_response_sanitized TEXT;

-- Store plaintext only for review responses (no HTML)
CREATE OR REPLACE FUNCTION sanitize_review_response()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.seller_response IS NOT NULL THEN
    -- Strip all HTML tags and dangerous content
    NEW.seller_response_sanitized := REGEXP_REPLACE(
      NEW.seller_response,
      '<[^>]*>|javascript:|on[a-z]+\s*=',
      '',
      'gi'
    );
    -- Limit to 1000 characters
    NEW.seller_response_sanitized := SUBSTRING(NEW.seller_response_sanitized, 1, 1000);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sanitize_response ON product_reviews;
CREATE TRIGGER trigger_sanitize_response
  BEFORE INSERT OR UPDATE ON product_reviews
  FOR EACH ROW
  EXECUTE FUNCTION sanitize_review_response();

-- Application should render: seller_response_sanitized (never seller_response raw)
