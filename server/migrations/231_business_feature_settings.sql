-- Migration 193: Business feature settings and configuration
-- Enable/disable features per business, feature flags, advanced settings

CREATE TABLE IF NOT EXISTS business_feature_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  bookings_enabled BOOLEAN DEFAULT TRUE,
  online_bookings_enabled BOOLEAN DEFAULT TRUE,
  phone_bookings_enabled BOOLEAN DEFAULT FALSE,
  messaging_enabled BOOLEAN DEFAULT TRUE,
  customer_messaging_enabled BOOLEAN DEFAULT TRUE,
  team_messaging_enabled BOOLEAN DEFAULT TRUE,
  appointment_reminders_enabled BOOLEAN DEFAULT TRUE,
  customer_feedback_enabled BOOLEAN DEFAULT TRUE,
  waitlist_enabled BOOLEAN DEFAULT FALSE,
  recurring_services_enabled BOOLEAN DEFAULT FALSE,
  group_bookings_enabled BOOLEAN DEFAULT FALSE,
  dynamic_pricing_enabled BOOLEAN DEFAULT TRUE,
  price_display_strategy VARCHAR(50) DEFAULT 'final' CHECK (price_display_strategy IN ('base', 'final', 'range')),
  inventory_tracking_enabled BOOLEAN DEFAULT FALSE,
  advance_payment_required BOOLEAN DEFAULT TRUE,
  deposit_required BOOLEAN DEFAULT FALSE,
  deposit_percent INTEGER CHECK (deposit_percent BETWEEN 0 AND 100),
  automatic_reminders_enabled BOOLEAN DEFAULT TRUE,
  manual_approval_required BOOLEAN DEFAULT FALSE,
  customer_cancellation_enabled BOOLEAN DEFAULT TRUE,
  staff_scheduling_visibility VARCHAR(50) DEFAULT 'private' CHECK (staff_scheduling_visibility IN ('private', 'business_only', 'public')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_feature_settings_business_id ON business_feature_settings(business_id);

CREATE TABLE IF NOT EXISTS business_advanced_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  stripe_connect_account_id VARCHAR(500),
  stripe_payment_method VARCHAR(50) DEFAULT 'card' CHECK (stripe_payment_method IN ('card', 'ach', 'all')),
  enable_subscription_services BOOLEAN DEFAULT FALSE,
  default_appointment_duration_minutes INTEGER DEFAULT 60,
  buffer_time_between_appointments_minutes INTEGER DEFAULT 0,
  api_webhook_secret VARCHAR(500),
  api_rate_limit_per_minute INTEGER DEFAULT 100,
  sms_from_number VARCHAR(20),
  email_from_address VARCHAR(255),
  email_from_name VARCHAR(255),
  allow_customer_rescheduling BOOLEAN DEFAULT TRUE,
  allow_customer_cancellations BOOLEAN DEFAULT TRUE,
  auto_confirm_bookings BOOLEAN DEFAULT FALSE,
  booking_confirmation_delay_hours INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_advanced_settings_business_id ON business_advanced_settings(business_id);

-- Feature usage/analytics
CREATE TABLE IF NOT EXISTS business_feature_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  feature_name VARCHAR(100) NOT NULL,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  month_year VARCHAR(7) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, feature_name, month_year)
);

CREATE INDEX idx_business_feature_usage_business_id ON business_feature_usage(business_id);
CREATE INDEX idx_business_feature_usage_month_year ON business_feature_usage(month_year);
