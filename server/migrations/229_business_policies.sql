-- Migration 191: Business policies and customer agreements
-- Per-business terms, cancellation policies, privacy, etc.

CREATE TABLE IF NOT EXISTS business_service_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID REFERENCES business_services(id) ON DELETE CASCADE,
  policy_type VARCHAR(50) NOT NULL CHECK (policy_type IN (
    'cancellation',
    'refund',
    'rescheduling',
    'no_show',
    'health_safety',
    'customer_agreement',
    'terms_conditions',
    'privacy',
    'custom'
  )),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  requires_customer_acceptance BOOLEAN DEFAULT TRUE,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_service_policies_business_id ON business_service_policies(business_id);
CREATE INDEX idx_business_service_policies_service_id ON business_service_policies(service_id);
CREATE INDEX idx_business_service_policies_policy_type ON business_service_policies(policy_type);
CREATE INDEX idx_business_service_policies_is_active ON business_service_policies(is_active);

CREATE TABLE IF NOT EXISTS customer_policy_acceptance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES business_service_policies(id) ON DELETE CASCADE,
  accepted_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ip_address VARCHAR(50),
  user_agent VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(customer_id, policy_id)
);

CREATE INDEX idx_customer_policy_acceptance_customer_id ON customer_policy_acceptance(customer_id);
CREATE INDEX idx_customer_policy_acceptance_policy_id ON customer_policy_acceptance(policy_id);

-- Specific policy: Cancellation
CREATE TABLE IF NOT EXISTS service_cancellation_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  cancellation_window_hours INTEGER NOT NULL DEFAULT 24,
  cancellation_fee_percent INTEGER CHECK (cancellation_fee_percent BETWEEN 0 AND 100),
  cancellation_fee_fixed_cents BIGINT,
  free_cancellation_up_to_hours INTEGER,
  no_show_fee_percent INTEGER CHECK (no_show_fee_percent BETWEEN 0 AND 100),
  no_show_fee_fixed_cents BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(service_id)
);

CREATE INDEX idx_service_cancellation_policy_service_id ON service_cancellation_policy(service_id);

-- Specific policy: No-show handling
CREATE TABLE IF NOT EXISTS service_no_show_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  grace_period_minutes INTEGER DEFAULT 15,
  fee_percent INTEGER,
  fee_fixed_cents BIGINT,
  max_no_shows_before_block INTEGER,
  auto_cancel_after_no_show BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(service_id)
);

CREATE INDEX idx_service_no_show_policy_service_id ON service_no_show_policy(service_id);
