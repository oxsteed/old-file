-- Migration 184: Dynamic pricing system (base tables)
-- Manages all pricing rules: base, time-based, demand-based, volume-based, customer segment, seasonal

CREATE TABLE IF NOT EXISTS service_price_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID REFERENCES business_services(id) ON DELETE CASCADE,
  rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('base', 'time', 'demand', 'volume', 'segment', 'seasonal')),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  rule_config JSONB NOT NULL,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_rule_or_business_wide CHECK (service_id IS NOT NULL OR rule_type = 'base')
);

CREATE INDEX idx_service_price_rules_business_id ON service_price_rules(business_id);
CREATE INDEX idx_service_price_rules_service_id ON service_price_rules(service_id);
CREATE INDEX idx_service_price_rules_rule_type ON service_price_rules(rule_type);
CREATE INDEX idx_service_price_rules_is_enabled ON service_price_rules(is_enabled);
CREATE INDEX idx_service_price_rules_priority ON service_price_rules(priority);

-- Time-based pricing (peak/off-peak hours)
CREATE TABLE IF NOT EXISTS service_price_time_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES service_price_rules(id) ON DELETE CASCADE,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME,
  end_time TIME,
  price_multiplier DECIMAL(5, 2) NOT NULL CHECK (price_multiplier > 0),
  price_modifier_cents BIGINT,
  is_peak BOOLEAN DEFAULT FALSE,
  description VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT time_multiplier_or_modifier CHECK ((price_multiplier IS NOT NULL AND price_modifier_cents IS NULL) OR (price_multiplier IS NULL AND price_modifier_cents IS NOT NULL) OR (price_multiplier IS NOT NULL))
);

CREATE INDEX idx_service_price_time_rules_rule_id ON service_price_time_rules(rule_id);
CREATE INDEX idx_service_price_time_rules_day_of_week ON service_price_time_rules(day_of_week);

-- Demand-based pricing (surge pricing)
CREATE TABLE IF NOT EXISTS service_price_demand_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES service_price_rules(id) ON DELETE CASCADE,
  availability_threshold_percent INTEGER NOT NULL CHECK (availability_threshold_percent BETWEEN 0 AND 100),
  price_multiplier DECIMAL(5, 2) NOT NULL CHECK (price_multiplier > 0),
  price_modifier_cents BIGINT,
  description VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_service_price_demand_rules_rule_id ON service_price_demand_rules(rule_id);

-- Volume-based pricing (bulk discounts)
CREATE TABLE IF NOT EXISTS service_price_volume_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES service_price_rules(id) ON DELETE CASCADE,
  min_quantity INTEGER NOT NULL CHECK (min_quantity > 0),
  max_quantity INTEGER,
  price_multiplier DECIMAL(5, 2),
  price_modifier_cents BIGINT,
  period VARCHAR(50) DEFAULT 'month' CHECK (period IN ('order', 'day', 'week', 'month')),
  description VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT max_gte_min CHECK (max_quantity IS NULL OR max_quantity >= min_quantity)
);

CREATE INDEX idx_service_price_volume_rules_rule_id ON service_price_volume_rules(rule_id);

-- Customer segment pricing (loyalty, VIP, etc.)
CREATE TABLE IF NOT EXISTS service_price_customer_segment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES service_price_rules(id) ON DELETE CASCADE,
  segment_name VARCHAR(100) NOT NULL,
  segment_type VARCHAR(50) NOT NULL CHECK (segment_type IN ('loyalty_tier', 'first_time', 'returning', 'vip', 'custom')),
  segment_criteria JSONB NOT NULL,
  price_multiplier DECIMAL(5, 2),
  price_modifier_cents BIGINT,
  min_customer_bookings INTEGER DEFAULT 0,
  max_customer_bookings INTEGER,
  description VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_service_price_customer_segment_rules_rule_id ON service_price_customer_segment_rules(rule_id);

-- Seasonal/date-range pricing
CREATE TABLE IF NOT EXISTS service_price_seasonal_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES service_price_rules(id) ON DELETE CASCADE,
  season_name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  price_multiplier DECIMAL(5, 2),
  fixed_price_cents BIGINT,
  price_modifier_cents BIGINT,
  apply_to_all_services BOOLEAN DEFAULT FALSE,
  priority_override INTEGER,
  description VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_date_range CHECK (start_date <= end_date),
  CONSTRAINT price_config CHECK ((fixed_price_cents IS NOT NULL) OR (price_multiplier IS NOT NULL) OR (price_modifier_cents IS NOT NULL))
);

CREATE INDEX idx_service_price_seasonal_rules_rule_id ON service_price_seasonal_rules(rule_id);
CREATE INDEX idx_service_price_seasonal_rules_date_range ON service_price_seasonal_rules(start_date, end_date);

-- Price override constraints (min/max caps)
CREATE TABLE IF NOT EXISTS service_price_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  min_price_cents BIGINT,
  max_price_cents BIGINT,
  apply_to_all_rules BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_price_range CHECK (min_price_cents IS NULL OR max_price_cents IS NULL OR min_price_cents <= max_price_cents)
);

CREATE INDEX idx_service_price_constraints_service_id ON service_price_constraints(service_id);
