-- Phase 5: Create moderation_queue table for admin review management

BEGIN;

CREATE TABLE IF NOT EXISTS moderation_queue (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL, -- 'review_flag', 'user_report', 'content_flag'
  target_id INTEGER NOT NULL,
  target_type VARCHAR(50) NOT NULL, -- 'review', 'user', 'job'
  reported_by INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'dismissed'
  assigned_to INTEGER REFERENCES users(id) NULL,
  resolution TEXT NULL,
  resolved_by INTEGER REFERENCES users(id) NULL,
  resolved_at TIMESTAMPTZ NULL,
  priority VARCHAR(10) DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_status ON moderation_queue(status);
CREATE INDEX IF NOT EXISTS idx_moderation_type ON moderation_queue(type);
CREATE INDEX IF NOT EXISTS idx_moderation_priority ON moderation_queue(priority);

-- Admin activity log for audit trail
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id INTEGER NOT NULL,
  details JSONB NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_log_admin ON admin_activity_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_action ON admin_activity_log(action);

-- Platform settings table for admin-configurable values
CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default platform settings
INSERT INTO platform_settings (key, value, description) VALUES
  ('platform_fee_percent', '15', 'Default platform fee percentage'),
  ('broker_fee_percent', '20', 'Broker mediated job fee percentage'),
  ('max_bid_limit_free', '5', 'Monthly bid limit for free tier'),
  ('max_bid_limit_basic', '20', 'Monthly bid limit for basic tier'),
  ('max_bid_limit_pro', '999', 'Monthly bid limit for pro tier'),
  ('review_flag_threshold', '3', 'Auto-hide review after N flags'),
  ('dispute_response_hours', '72', 'Hours to respond to dispute'),
  ('escrow_hold_days', '7', 'Days to hold escrow after completion')
ON CONFLICT (key) DO NOTHING;

COMMIT;
