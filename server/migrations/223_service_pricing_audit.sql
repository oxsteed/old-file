-- Migration 185: Pricing calculation audit trail and history
-- Tracks pricing changes and calculations for transparency and debugging

CREATE TABLE IF NOT EXISTS service_price_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES business_appointments(id) ON DELETE SET NULL,
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  base_price_cents BIGINT NOT NULL,
  final_price_cents BIGINT NOT NULL,
  calculation_details JSONB NOT NULL,
  applied_rules UUID[] DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_service_price_calculations_appointment_id ON service_price_calculations(appointment_id);
CREATE INDEX idx_service_price_calculations_service_id ON service_price_calculations(service_id);
CREATE INDEX idx_service_price_calculations_customer_id ON service_price_calculations(customer_id);
CREATE INDEX idx_service_price_calculations_created_at ON service_price_calculations(created_at DESC);
CREATE INDEX idx_service_price_calculations_booking_date ON service_price_calculations(booking_date);

CREATE TABLE IF NOT EXISTS service_price_rule_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES service_price_rules(id) ON DELETE CASCADE,
  change_type VARCHAR(50) NOT NULL CHECK (change_type IN ('created', 'enabled', 'disabled', 'updated', 'deleted')),
  old_values JSONB,
  new_values JSONB,
  changed_by_id UUID NOT NULL REFERENCES users(id),
  change_reason VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_service_price_rule_changes_rule_id ON service_price_rule_changes(rule_id);
CREATE INDEX idx_service_price_rule_changes_changed_by_id ON service_price_rule_changes(changed_by_id);
CREATE INDEX idx_service_price_rule_changes_created_at ON service_price_rule_changes(created_at DESC);

CREATE TABLE IF NOT EXISTS service_pricing_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_bookings INTEGER DEFAULT 0,
  average_base_price_cents BIGINT,
  average_final_price_cents BIGINT,
  price_variance_percent DECIMAL(5, 2),
  peak_hour_bookings INTEGER DEFAULT 0,
  off_peak_bookings INTEGER DEFAULT 0,
  surge_pricing_applied_count INTEGER DEFAULT 0,
  discount_applied_count INTEGER DEFAULT 0,
  total_revenue_cents BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, service_id, date)
);

CREATE INDEX idx_service_pricing_analytics_business_id ON service_pricing_analytics(business_id);
CREATE INDEX idx_service_pricing_analytics_service_id ON service_pricing_analytics(service_id);
CREATE INDEX idx_service_pricing_analytics_date ON service_pricing_analytics(date DESC);
