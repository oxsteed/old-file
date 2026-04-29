-- API Products for digital/SaaS product sales
CREATE TABLE IF NOT EXISTS api_products (
  id BIGSERIAL PRIMARY KEY,
  creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
