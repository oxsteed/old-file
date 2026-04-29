-- Affiliate commission tracking and payouts
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id BIGSERIAL PRIMARY KEY,
  helper_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_type VARCHAR(50) NOT NULL, -- home_depot, amazon, custom
  affiliate_id VARCHAR(255), -- External affiliate ID
  commission_rate DECIMAL(5,2), -- 1.5, 2.5, etc. (percent)
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, inactive, suspended
  total_commission_cents BIGINT DEFAULT 0,
  total_paid_cents BIGINT DEFAULT 0,
  pending_cents BIGINT DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_affiliate_programs_helper_id ON affiliate_programs(helper_id);
CREATE INDEX idx_affiliate_programs_status ON affiliate_programs(status);
UNIQUE (helper_id, program_type); -- One program per helper per type

-- Affiliate commissions (calculated per order)
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES marketplace_products(id) ON DELETE RESTRICT,
  commission_cents BIGINT NOT NULL,
  commission_rate DECIMAL(5,2),
  product_sale_amount_cents BIGINT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, confirmed, paid, failed
  payout_id BIGINT REFERENCES affiliate_payouts(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMP,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_affiliate_commissions_order_id ON affiliate_commissions(order_id);
CREATE INDEX idx_affiliate_commissions_affiliate_program_id ON affiliate_commissions(affiliate_program_id);
CREATE INDEX idx_affiliate_commissions_status ON affiliate_commissions(status);

-- Affiliate payouts (monthly/periodic payouts)
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id BIGSERIAL PRIMARY KEY,
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_commission_cents BIGINT NOT NULL,
  commission_count INT NOT NULL,
  payout_method VARCHAR(50), -- stripe_direct, bank_transfer, check
  payout_reference VARCHAR(255), -- Stripe payout ID, ACH reference, check number
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed, reversed
  payment_method_id VARCHAR(255), -- Stripe bank account ID, etc.
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP,
  received_at TIMESTAMP,
  failed_reason TEXT
);
CREATE INDEX idx_affiliate_payouts_affiliate_program_id ON affiliate_payouts(affiliate_program_id);
CREATE INDEX idx_affiliate_payouts_period_start ON affiliate_payouts(period_start DESC);
CREATE INDEX idx_affiliate_payouts_status ON affiliate_payouts(status);

-- Affiliate performance metrics (cached for analytics)
CREATE TABLE IF NOT EXISTS affiliate_metrics (
  id BIGSERIAL PRIMARY KEY,
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  clicks INT DEFAULT 0,
  conversions INT DEFAULT 0,
  conversion_rate DECIMAL(5,2),
  total_commission_cents BIGINT DEFAULT 0,
  average_order_value_cents BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_affiliate_metrics_affiliate_program_id ON affiliate_metrics(affiliate_program_id);
CREATE INDEX idx_affiliate_metrics_metric_date ON affiliate_metrics(metric_date DESC);
UNIQUE (affiliate_program_id, metric_date);
