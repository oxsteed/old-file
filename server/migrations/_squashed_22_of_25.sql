
-- >>> BEGIN: 131_affiliate_payouts_system.sql <<<
-- Affiliate commission tracking and payouts
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id BIGSERIAL PRIMARY KEY,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_type VARCHAR(50) NOT NULL, -- home_depot, amazon, custom
  affiliate_id VARCHAR(255), -- External affiliate ID
  commission_rate DECIMAL(5,2), -- 1.5, 2.5, etc. (percent)
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, inactive, suspended
  total_commission_cents BIGINT DEFAULT 0,
  total_paid_cents BIGINT DEFAULT 0,
  pending_cents BIGINT DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (helper_id, program_type)
);

CREATE INDEX idx_affiliate_programs_helper_id ON affiliate_programs(helper_id);
CREATE INDEX idx_affiliate_programs_status ON affiliate_programs(status);

-- Affiliate payouts (monthly/periodic payouts) - must be created before affiliate_commissions
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

-- Affiliate commissions (calculated per order)
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  affiliate_program_id BIGINT NOT NULL REFERENCES affiliate_programs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE RESTRICT,
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (affiliate_program_id, metric_date)
);

CREATE INDEX idx_affiliate_metrics_affiliate_program_id ON affiliate_metrics(affiliate_program_id);
CREATE INDEX idx_affiliate_metrics_metric_date ON affiliate_metrics(metric_date DESC);

-- >>> END: 131_affiliate_payouts_system.sql <<<

-- >>> BEGIN: 132_add_inventory_management.sql <<<
-- Add inventory management to marketplace products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'quantity_available'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN quantity_available INTEGER DEFAULT 999999;
    ALTER TABLE marketplace_products ADD CONSTRAINT chk_quantity_available CHECK (quantity_available >= 0);
    CREATE INDEX idx_marketplace_products_quantity ON marketplace_products(quantity_available);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'marketplace_products' AND column_name = 'quantity_sold'
  ) THEN
    ALTER TABLE marketplace_products ADD COLUMN quantity_sold INTEGER DEFAULT 0;
  END IF;
END $$;

-- >>> END: 132_add_inventory_management.sql <<<

-- >>> BEGIN: 133_discount_codes_system.sql <<<
-- Discount codes/promo codes system
CREATE TABLE IF NOT EXISTS discount_codes (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  discount_type VARCHAR(20) NOT NULL, -- 'percentage' or 'fixed_cents'
  discount_amount BIGINT NOT NULL CHECK (discount_amount > 0),
  max_discount_cents BIGINT, -- Cap on percentage discounts
  usage_limit INT, -- Max times code can be used
  usage_count INT DEFAULT 0,
  min_order_cents BIGINT DEFAULT 0, -- Minimum order value required
  max_order_cents BIGINT, -- Maximum order value eligible
  applicable_categories VARCHAR(255)[], -- NULL = all categories
  applicable_products UUID[], -- NULL = all products
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, inactive, expired
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_discount_codes_code ON discount_codes(code);
CREATE INDEX idx_discount_codes_status ON discount_codes(status);
CREATE INDEX idx_discount_codes_active ON discount_codes(status, start_date, end_date)
  WHERE status = 'active';

-- Track which discounts were applied to orders
CREATE TABLE IF NOT EXISTS order_discount_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  discount_code_id BIGINT NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
  code VARCHAR(50) NOT NULL,
  discount_applied_cents BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_discount_history_order_id ON order_discount_history(order_id);
CREATE INDEX idx_order_discount_history_code_id ON order_discount_history(discount_code_id);

-- >>> END: 133_discount_codes_system.sql <<<

-- >>> BEGIN: 134_order_management_fields.sql <<<
-- Migration 134: Add order management fields for admin dashboard
-- Adds shipped tracking, refund tracking, and performance indexes

-- Only alter tables if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_orders') THEN
    ALTER TABLE marketplace_orders
      ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255),
      ADD COLUMN IF NOT EXISTS refund_reason TEXT,
      ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_order_items') THEN
    ALTER TABLE marketplace_order_items
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
  END IF;
END $$;

-- Performance indexes for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON marketplace_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON marketplace_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_shipped ON marketplace_orders(status, shipped_at DESC);

-- Tracking audit log for order actions
CREATE TABLE IF NOT EXISTS order_action_log (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  action_details JSONB,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_action_log_order_id ON order_action_log(order_id);
CREATE INDEX idx_order_action_log_created_at ON order_action_log(created_at DESC);

-- >>> END: 134_order_management_fields.sql <<<

-- >>> BEGIN: 135_email_frequency_preferences.sql <<<
-- Migration 135: Email frequency preferences and digest queue
-- Enables granular control over email notifications with daily/weekly digest options

-- Only alter table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences') THEN
    ALTER TABLE notification_preferences
      ADD COLUMN IF NOT EXISTS email_frequency VARCHAR(20) DEFAULT 'real-time',
      ADD COLUMN IF NOT EXISTS unsubscribe_all BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS unsubscribed_from_bulk_emails BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS email_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- Unsubscribe tokens for email footer links (one-click unsubscribe)
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_tokens_user ON email_unsubscribe_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_tokens_token ON email_unsubscribe_tokens(token);

-- Queue for batching notifications into daily/weekly digests
CREATE TABLE IF NOT EXISTS email_digest_queue (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  digest_type VARCHAR(20),
  queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP,
  UNIQUE(notification_id)
);

CREATE INDEX IF NOT EXISTS idx_email_digest_queue_user ON email_digest_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_email_digest_queue_unsent ON email_digest_queue(user_id) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_digest_queue_queued ON email_digest_queue(queued_at);

-- >>> END: 135_email_frequency_preferences.sql <<<

-- >>> BEGIN: 136_sms_notification_preferences.sql <<<
-- Migration 136: SMS notification preferences and tracking
-- Enables SMS opt-in, phone verification, and SMS delivery logging

-- Only alter tables if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_preferences') THEN
    ALTER TABLE notification_preferences
      ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS sms_order_created BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS sms_payment_confirmed BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS sms_order_shipped BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS sms_order_cancelled BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS sms_order_refunded BOOLEAN DEFAULT TRUE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20),
      ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP;
  END IF;
END $$;

-- SMS verification tokens (OTP codes)
CREATE TABLE IF NOT EXISTS sms_opt_in_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number VARCHAR(20) NOT NULL,
  token VARCHAR(6),
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '15 minutes',
  verified_at TIMESTAMP,
  UNIQUE(user_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_sms_opt_in_tokens_user ON sms_opt_in_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_opt_in_tokens_phone ON sms_opt_in_tokens(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_opt_in_tokens_expires ON sms_opt_in_tokens(expires_at);

-- SMS delivery logs for audit trail and rate limiting
CREATE TABLE IF NOT EXISTS sms_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number VARCHAR(20),
  message_body TEXT,
  notification_type VARCHAR(50),
  twilio_sid VARCHAR(255),
  status VARCHAR(50),
  error_message TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_user_id ON sms_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_sent_at ON sms_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_user_date ON sms_logs(user_id, sent_at DESC);

-- >>> END: 136_sms_notification_preferences.sql <<<
