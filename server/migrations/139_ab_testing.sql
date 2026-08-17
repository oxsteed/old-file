-- Migration 139: A/B Testing Framework for Discount Codes
-- Comprehensive A/B testing system with statistical significance testing

CREATE TABLE IF NOT EXISTS ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_name VARCHAR(255) NOT NULL,
  description TEXT,
  test_type VARCHAR(50) NOT NULL, -- 'discount_code', 'pricing', 'messaging'
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'running', 'paused', 'completed'

  -- Test duration
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  planned_duration_days INTEGER,

  -- Targeting
  target_audience VARCHAR(100), -- 'all', 'new_users', 'returning', 'segment_name'
  traffic_allocation_percentage INTEGER DEFAULT 100, -- 0-100

  -- Statistical parameters
  min_sample_size INTEGER DEFAULT 100,
  confidence_level DECIMAL(3,2) DEFAULT 0.95, -- 95% confidence
  power DECIMAL(3,2) DEFAULT 0.80, -- 80% power
  expected_effect_size DECIMAL(5,3), -- Expected uplift percentage

  -- Status flags
  winner_id UUID, -- Reference to winning variant
  statistically_significant BOOLEAN DEFAULT FALSE,
  p_value DECIMAL(10,6),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_tests_helper_id ON ab_tests(helper_id);
CREATE INDEX idx_ab_tests_status ON ab_tests(status);

-- A/B test variants
CREATE TABLE IF NOT EXISTS ab_test_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_name VARCHAR(255) NOT NULL, -- 'Control', 'Variant A', 'Variant B', etc.
  is_control BOOLEAN DEFAULT FALSE,

  -- For discount code tests
  discount_code_id BIGINT REFERENCES discount_codes(id),

  -- Variant configuration
  discount_percentage DECIMAL(5,2),
  discount_fixed_amount_cents BIGINT,
  discount_description TEXT,

  -- Metrics snapshots
  views_count BIGINT DEFAULT 0,
  clicks_count BIGINT DEFAULT 0,
  conversions_count BIGINT DEFAULT 0,
  revenue_cents BIGINT DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_variants_test_id ON ab_test_variants(test_id);
CREATE INDEX idx_ab_test_variants_is_control ON ab_test_variants(is_control);

-- Session-level test assignment tracking
CREATE TABLE IF NOT EXISTS ab_test_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(255),

  -- Event tracking
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  viewed_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  converted_at TIMESTAMP WITH TIME ZONE,

  -- Revenue tracking
  order_id BIGINT REFERENCES marketplace_orders(id),
  revenue_cents BIGINT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_assignments_test_variant ON ab_test_assignments(test_id, variant_id);
CREATE INDEX idx_ab_test_assignments_user ON ab_test_assignments(user_id);
CREATE INDEX idx_ab_test_assignments_assigned_at ON ab_test_assignments(assigned_at);

-- Daily aggregated metrics per variant
CREATE TABLE IF NOT EXISTS ab_test_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES ab_test_variants(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,

  -- Counts
  new_assignments BIGINT DEFAULT 0,
  total_views BIGINT DEFAULT 0,
  total_clicks BIGINT DEFAULT 0,
  total_conversions BIGINT DEFAULT 0,
  total_revenue_cents BIGINT DEFAULT 0,

  -- Rates
  conversion_rate DECIMAL(5,2),
  click_through_rate DECIMAL(5,2),
  average_order_value_cents BIGINT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_daily_metrics_variant_date ON ab_test_daily_metrics(variant_id, metric_date);

-- Statistical analysis results (cached)
CREATE TABLE IF NOT EXISTS ab_test_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Variant 1 (Control) stats
  variant1_id UUID REFERENCES ab_test_variants(id),
  variant1_conversions BIGINT,
  variant1_conversion_rate DECIMAL(5,3),
  variant1_confidence_interval_lower DECIMAL(5,3),
  variant1_confidence_interval_upper DECIMAL(5,3),

  -- Variant 2 stats
  variant2_id UUID REFERENCES ab_test_variants(id),
  variant2_conversions BIGINT,
  variant2_conversion_rate DECIMAL(5,3),
  variant2_confidence_interval_lower DECIMAL(5,3),
  variant2_confidence_interval_upper DECIMAL(5,3),

  -- Chi-square test results
  chi_square_statistic DECIMAL(10,4),
  p_value DECIMAL(10,6),
  degrees_of_freedom INTEGER,

  -- Practical significance
  relative_uplift_percentage DECIMAL(5,2), -- (V2 - V1) / V1 * 100
  is_statistically_significant BOOLEAN,
  confidence_level_achieved DECIMAL(3,2),

  -- Sample sizes
  variant1_sample_size BIGINT,
  variant2_sample_size BIGINT,
  total_sample_size BIGINT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_statistics_test_id ON ab_test_statistics(test_id);

-- A/B test reports (for export and history)
CREATE TABLE IF NOT EXISTS ab_test_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  report_type VARCHAR(50) NOT NULL, -- 'interim', 'final'

  summary_json JSONB, -- Stores summary metrics
  statistical_results JSONB, -- Stores chi-square and p-value results
  recommendation TEXT, -- 'Continue test', 'Stop - Variant A wins', etc.

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ab_test_reports_test_id ON ab_test_reports(test_id);
