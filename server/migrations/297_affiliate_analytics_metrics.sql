-- Affiliate analytics tables used by /api/affiliate/:programId/analytics/*.
-- The earlier draft of this migration lived outside server/migrations and used
-- UUID program IDs; affiliate_programs.id is BIGSERIAL, so these FKs are BIGINT.

CREATE TABLE IF NOT EXISTS affiliate_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  total_clicks BIGINT DEFAULT 0,
  unique_visitors BIGINT DEFAULT 0,
  total_conversions BIGINT DEFAULT 0,
  conversion_rate DECIMAL(5,2) DEFAULT 0,
  total_order_value_cents BIGINT DEFAULT 0,
  average_order_value_cents BIGINT DEFAULT 0,
  commission_earned_cents BIGINT DEFAULT 0,
  desktop_clicks BIGINT DEFAULT 0,
  mobile_clicks BIGINT DEFAULT 0,
  tablet_clicks BIGINT DEFAULT 0,
  top_referrer VARCHAR(255),
  top_referrer_clicks BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(affiliate_program_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_daily_metrics_program_date
  ON affiliate_daily_metrics(affiliate_program_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_affiliate_daily_metrics_date
  ON affiliate_daily_metrics(metric_date);

CREATE TABLE IF NOT EXISTS affiliate_conversion_funnel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  funnel_date DATE NOT NULL,
  stage_click_count BIGINT DEFAULT 0,
  stage_landing_count BIGINT DEFAULT 0,
  stage_product_view_count BIGINT DEFAULT 0,
  stage_add_to_cart_count BIGINT DEFAULT 0,
  stage_checkout_count BIGINT DEFAULT 0,
  stage_purchase_count BIGINT DEFAULT 0,
  landing_rate DECIMAL(5,2) DEFAULT 0,
  product_rate DECIMAL(5,2) DEFAULT 0,
  cart_rate DECIMAL(5,2) DEFAULT 0,
  checkout_rate DECIMAL(5,2) DEFAULT 0,
  purchase_rate DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(affiliate_program_id, funnel_date)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_conversion_funnel_program_date
  ON affiliate_conversion_funnel(affiliate_program_id, funnel_date);

CREATE TABLE IF NOT EXISTS affiliate_product_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  total_clicks BIGINT DEFAULT 0,
  total_conversions BIGINT DEFAULT 0,
  conversion_rate DECIMAL(5,2) DEFAULT 0,
  total_revenue_cents BIGINT DEFAULT 0,
  commission_earned_cents BIGINT DEFAULT 0,
  views_count BIGINT DEFAULT 0,
  add_to_cart_count BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(affiliate_program_id, product_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_metrics_program_date
  ON affiliate_product_metrics(affiliate_program_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_affiliate_product_metrics_product
  ON affiliate_product_metrics(product_id);

CREATE TABLE IF NOT EXISTS affiliate_top_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  rank BIGINT,
  total_clicks_30d BIGINT,
  total_conversions_30d BIGINT,
  conversion_rate_30d DECIMAL(5,2),
  total_revenue_30d_cents BIGINT,
  total_commission_30d_cents BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_top_products_program_date
  ON affiliate_top_products(affiliate_program_id, metric_date);

CREATE TABLE IF NOT EXISTS affiliate_visitor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  session_id VARCHAR(255) NOT NULL,
  visitor_ip VARCHAR(45),
  visitor_country VARCHAR(100),
  device_type VARCHAR(50),
  referrer_source VARCHAR(255),
  session_stage VARCHAR(50) DEFAULT 'click',
  last_product_viewed_id UUID REFERENCES marketplace_products(id),
  clicked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  landed_at TIMESTAMP WITH TIME ZONE,
  product_viewed_at TIMESTAMP WITH TIME ZONE,
  cart_added_at TIMESTAMP WITH TIME ZONE,
  checkout_started_at TIMESTAMP WITH TIME ZONE,
  purchased_at TIMESTAMP WITH TIME ZONE,
  session_ended_at TIMESTAMP WITH TIME ZONE,
  session_duration_seconds BIGINT,
  pages_viewed BIGINT DEFAULT 0,
  attributed_order_id BIGINT REFERENCES marketplace_orders(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_visitor_sessions_program
  ON affiliate_visitor_sessions(affiliate_program_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_visitor_sessions_session_id
  ON affiliate_visitor_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_visitor_sessions_stage
  ON affiliate_visitor_sessions(session_stage);
CREATE INDEX IF NOT EXISTS idx_affiliate_visitor_sessions_clicked_at
  ON affiliate_visitor_sessions(clicked_at);
