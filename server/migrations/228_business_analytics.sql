-- Migration 190: Business analytics and reporting
-- Track metrics, revenue, customer engagement for business insights

CREATE TABLE IF NOT EXISTS business_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_appointments INTEGER DEFAULT 0,
  completed_appointments INTEGER DEFAULT 0,
  cancelled_appointments INTEGER DEFAULT 0,
  no_show_appointments INTEGER DEFAULT 0,
  total_revenue_cents BIGINT DEFAULT 0,
  average_appointment_value_cents BIGINT,
  unique_customers INTEGER DEFAULT 0,
  new_customers INTEGER DEFAULT 0,
  returning_customers INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, date)
);

CREATE INDEX idx_business_daily_metrics_business_id ON business_daily_metrics(business_id);
CREATE INDEX idx_business_daily_metrics_date ON business_daily_metrics(date DESC);

CREATE TABLE IF NOT EXISTS business_service_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_bookings INTEGER DEFAULT 0,
  completed_bookings INTEGER DEFAULT 0,
  cancelled_bookings INTEGER DEFAULT 0,
  average_price_cents BIGINT,
  total_revenue_cents BIGINT DEFAULT 0,
  customer_satisfaction_avg DECIMAL(3, 2),
  no_show_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, service_id, date)
);

CREATE INDEX idx_business_service_metrics_business_id ON business_service_metrics(business_id);
CREATE INDEX idx_business_service_metrics_service_id ON business_service_metrics(service_id);
CREATE INDEX idx_business_service_metrics_date ON business_service_metrics(date DESC);

CREATE TABLE IF NOT EXISTS business_revenue_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period VARCHAR(50) NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'yearly')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_revenue_cents BIGINT DEFAULT 0,
  total_fees_cents BIGINT DEFAULT 0,
  net_revenue_cents BIGINT DEFAULT 0,
  total_appointments INTEGER DEFAULT 0,
  average_appointment_value_cents BIGINT,
  payment_success_rate DECIMAL(5, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, period, start_date, end_date)
);

CREATE INDEX idx_business_revenue_summary_business_id ON business_revenue_summary(business_id);
CREATE INDEX idx_business_revenue_summary_period ON business_revenue_summary(period);

CREATE TABLE IF NOT EXISTS staff_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_appointments INTEGER DEFAULT 0,
  completed_appointments INTEGER DEFAULT 0,
  cancelled_appointments INTEGER DEFAULT 0,
  no_show_count INTEGER DEFAULT 0,
  average_customer_rating DECIMAL(3, 2),
  average_booking_value_cents BIGINT,
  total_revenue_cents BIGINT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, staff_id, date)
);

CREATE INDEX idx_staff_performance_metrics_business_id ON staff_performance_metrics(business_id);
CREATE INDEX idx_staff_performance_metrics_staff_id ON staff_performance_metrics(staff_id);
CREATE INDEX idx_staff_performance_metrics_date ON staff_performance_metrics(date DESC);

CREATE TABLE IF NOT EXISTS appointment_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  would_recommend BOOLEAN,
  feedback_text TEXT,
  tags VARCHAR(100)[],
  responded_to BOOLEAN DEFAULT FALSE,
  response_text TEXT,
  responded_by_id UUID REFERENCES users(id),
  responded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_appointment_feedback_appointment_id ON appointment_feedback(appointment_id);
CREATE INDEX idx_appointment_feedback_rating ON appointment_feedback(rating);
CREATE INDEX idx_appointment_feedback_created_at ON appointment_feedback(created_at DESC);
