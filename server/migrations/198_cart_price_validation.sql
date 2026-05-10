-- VULN #22 FIX: Validate cart prices before payment

ALTER TABLE shopping_carts ADD COLUMN IF NOT EXISTS total_cents_verified_at TIMESTAMP;

-- Create function to verify cart totals
CREATE OR REPLACE FUNCTION verify_cart_total(
  p_cart_id UUID
)
RETURNS TABLE(
  is_valid BOOLEAN,
  stored_total BIGINT,
  calculated_total BIGINT,
  variance_cents BIGINT
) AS $$
DECLARE
  v_stored_total BIGINT;
  v_calculated_total BIGINT;
BEGIN
  -- Get stored total
  SELECT total_cents INTO v_stored_total
  FROM shopping_carts WHERE id = p_cart_id;

  -- Calculate actual total from items
  SELECT COALESCE(SUM(price_cents * quantity), 0) INTO v_calculated_total
  FROM shopping_cart_items
  WHERE cart_id = p_cart_id AND deleted_at IS NULL;

  -- Check if variance is acceptable (within $0.01 tolerance for rounding)
  RETURN QUERY SELECT
    (ABS(v_stored_total - v_calculated_total) <= 1),
    v_stored_total,
    v_calculated_total,
    (v_stored_total - v_calculated_total);
END;
$$ LANGUAGE plpgsql;

-- Before processing payment, ALWAYS verify cart total
-- SELECT is_valid FROM verify_cart_total($1)
-- If not is_valid, reject with 400 "Cart total mismatch"
