-- Discount codes/promo codes system
CREATE TABLE IF NOT EXISTS discount_codes (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  discount_type VARCHAR(20) NOT NULL, -- 'percentage' or 'fixed_cents'
  discount_amount BIGINT NOT NULL CHECK (discount_amount > 0),
  max_discount_cents BIGINT, -- Cap on percentage discounts
  usage_limit INT, -- Max times code can be used
  usage_count INT DEFAULT 0,
  min_order_cents BIGINT DEFAULT 0, -- Minimum order value required
  max_order_cents BIGINT, -- Maximum order value eligible
  applicable_categories VARCHAR(255)[], -- NULL = all categories
  applicable_products UUID[], -- NULL = all products
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, inactive, expired
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_discount_codes_code ON discount_codes(code);
CREATE INDEX idx_discount_codes_status ON discount_codes(status);
CREATE INDEX idx_discount_codes_active ON discount_codes(status, start_date, end_date)
  WHERE status = 'active';

-- Track which discounts were applied to orders
CREATE TABLE IF NOT EXISTS order_discount_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  discount_code_id BIGINT NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
  code VARCHAR(50) NOT NULL,
  discount_applied_cents BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_discount_history_order_id ON order_discount_history(order_id);
CREATE INDEX idx_order_discount_history_code_id ON order_discount_history(discount_code_id);
