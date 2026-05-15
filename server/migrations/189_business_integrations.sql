-- Migration 189: Business integrations and webhooks
-- Connect to external services (Stripe, Google Calendar, Zapier, etc.)

CREATE TABLE IF NOT EXISTS business_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  integration_type VARCHAR(100) NOT NULL CHECK (integration_type IN (
    'stripe',
    'google_calendar',
    'outlook_calendar',
    'apple_calendar',
    'square',
    'zoom',
    'zapier',
    'slack',
    'custom_webhook'
  )),
  integration_name VARCHAR(255) NOT NULL,
  is_connected BOOLEAN DEFAULT FALSE,
  is_enabled BOOLEAN DEFAULT TRUE,
  auth_token VARCHAR(2048),
  auth_refresh_token VARCHAR(2048),
  auth_expires_at TIMESTAMP WITH TIME ZONE,
  config_json JSONB,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, integration_type)
);

CREATE INDEX idx_business_integrations_business_id ON business_integrations(business_id);
CREATE INDEX idx_business_integrations_integration_type ON business_integrations(integration_type);
CREATE INDEX idx_business_integrations_is_connected ON business_integrations(is_connected);
CREATE INDEX idx_business_integrations_is_enabled ON business_integrations(is_enabled);

CREATE TABLE IF NOT EXISTS business_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  webhook_url VARCHAR(2048) NOT NULL,
  webhook_secret VARCHAR(500),
  event_types VARCHAR(100)[] NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  max_retries INTEGER DEFAULT 3,
  timeout_seconds INTEGER DEFAULT 30,
  custom_headers JSONB,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_webhooks_business_id ON business_webhooks(business_id);
CREATE INDEX idx_business_webhooks_is_active ON business_webhooks(is_active);

CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES business_webhooks(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  http_status_code INTEGER,
  response_body TEXT,
  attempt_number INTEGER DEFAULT 1,
  error_message TEXT,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhook_delivery_log_webhook_id ON webhook_delivery_log(webhook_id);
CREATE INDEX idx_webhook_delivery_log_event_type ON webhook_delivery_log(event_type);
CREATE INDEX idx_webhook_delivery_log_created_at ON webhook_delivery_log(created_at DESC);

CREATE TABLE IF NOT EXISTS business_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  payment_provider VARCHAR(100) NOT NULL CHECK (payment_provider IN ('stripe', 'square', 'paypal')),
  provider_account_id VARCHAR(500),
  display_name VARCHAR(255),
  is_primary BOOLEAN DEFAULT FALSE,
  is_enabled BOOLEAN DEFAULT TRUE,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, payment_provider, provider_account_id)
);

CREATE INDEX idx_business_payment_methods_business_id ON business_payment_methods(business_id);
CREATE INDEX idx_business_payment_methods_is_primary ON business_payment_methods(is_primary);
CREATE INDEX idx_business_payment_methods_is_enabled ON business_payment_methods(is_enabled);
