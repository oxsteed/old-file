-- Product marketplace orders and transactions
CREATE TABLE IF NOT EXISTS marketplace_orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
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
