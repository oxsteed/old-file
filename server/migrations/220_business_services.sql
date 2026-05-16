-- Migration 182: Business services and service staff assignments
-- Services are time-based offerings that can be booked by customers

CREATE TABLE IF NOT EXISTS business_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  preparation_minutes INTEGER DEFAULT 0,
  base_price_cents BIGINT NOT NULL CHECK (base_price_cents >= 0),
  max_capacity INTEGER NOT NULL DEFAULT 1 CHECK (max_capacity >= 1),
  min_notice_hours INTEGER DEFAULT 24 CHECK (min_notice_hours >= 0),
  cancellation_policy_hours INTEGER DEFAULT 24 CHECK (cancellation_policy_hours >= 0),
  cancellation_fee_percent INTEGER DEFAULT 0 CHECK (cancellation_fee_percent BETWEEN 0 AND 100),
  is_active BOOLEAN DEFAULT TRUE,
  requires_customer_info BOOLEAN DEFAULT TRUE,
  allow_online_booking BOOLEAN DEFAULT TRUE,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_business_services_business_id ON business_services(business_id);
CREATE INDEX idx_business_services_is_active ON business_services(is_active);
CREATE INDEX idx_business_services_created_at ON business_services(created_at DESC);
CREATE INDEX idx_business_services_deleted_at ON business_services(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS business_service_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_available BOOLEAN DEFAULT TRUE,
  service_price_override_cents BIGINT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(service_id, staff_id)
);

CREATE INDEX idx_business_service_staff_service_id ON business_service_staff(service_id);
CREATE INDEX idx_business_service_staff_staff_id ON business_service_staff(staff_id);

CREATE TABLE IF NOT EXISTS business_service_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_time_range CHECK (start_time < end_time),
  CONSTRAINT unique_staff_service_day UNIQUE (staff_id, service_id, day_of_week) WHERE staff_id IS NOT NULL,
  CONSTRAINT unique_service_day UNIQUE (service_id, day_of_week) WHERE staff_id IS NULL
);

CREATE INDEX idx_business_service_availability_service_id ON business_service_availability(service_id);
CREATE INDEX idx_business_service_availability_staff_id ON business_service_availability(staff_id);
CREATE INDEX idx_business_service_availability_day_of_week ON business_service_availability(day_of_week);

CREATE TABLE IF NOT EXISTS business_service_blocked_times (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES business_services(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  reason VARCHAR(500),
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_block_time_range CHECK (start_time < end_time),
  CONSTRAINT block_requires_service_or_staff CHECK (service_id IS NOT NULL OR staff_id IS NOT NULL)
);

CREATE INDEX idx_business_service_blocked_times_service_id ON business_service_blocked_times(service_id);
CREATE INDEX idx_business_service_blocked_times_staff_id ON business_service_blocked_times(staff_id);
CREATE INDEX idx_business_service_blocked_times_business_id ON business_service_blocked_times(business_id);
CREATE INDEX idx_business_service_blocked_times_time_range ON business_service_blocked_times(start_time, end_time);

CREATE TABLE IF NOT EXISTS business_booking_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  min_advance_booking_hours INTEGER DEFAULT 0 CHECK (min_advance_booking_hours >= 0),
  max_advance_booking_days INTEGER DEFAULT 365 CHECK (max_advance_booking_days > 0),
  cancellation_allowed_hours_before INTEGER DEFAULT 24 CHECK (cancellation_allowed_hours_before >= 0),
  require_payment_upfront BOOLEAN DEFAULT TRUE,
  allow_customer_reschedule BOOLEAN DEFAULT TRUE,
  require_customer_confirmation BOOLEAN DEFAULT FALSE,
  auto_cancel_no_show_hours INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_booking_rules_business_id ON business_booking_rules(business_id);
