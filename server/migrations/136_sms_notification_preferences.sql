-- Migration 136: SMS notification preferences and tracking
-- Enables SMS opt-in, phone verification, and SMS delivery logging

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_order_created BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_payment_confirmed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_order_shipped BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_order_cancelled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_order_refunded BOOLEAN DEFAULT TRUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP;

-- SMS verification tokens (OTP codes)
CREATE TABLE IF NOT EXISTS sms_opt_in_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
