-- Migration 023: Create platform_settings and feature_flags tables
-- These tables power the Super Admin > Platform Settings page

-- Platform settings (key-value store for admin-editable settings)
CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  value_type VARCHAR(20) DEFAULT 'text',
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feature flags (boolean toggles for platform features)
CREATE TABLE IF NOT EXISTS feature_flags (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT false,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default platform settings
INSERT INTO platform_settings (key, value, value_type, description) VALUES
  ('platform_fee_starter', '0', 'number', 'Fee percentage for Starter (free) tier jobs'),
  ('platform_fee_pro', '5', 'number', 'Fee percentage for Pro tier jobs'),
  ('platform_fee_elite', '5', 'number', 'Fee percentage for Elite tier jobs'),
  ('platform_fee_broker', '10', 'number', 'Fee percentage for broker-mediated jobs'),
  ('broker_cut_rate', '3', 'number', 'Percentage of job fee that goes to the broker'),
  ('max_job_budget', '10000', 'number', 'Maximum allowed job budget in dollars'),
  ('bid_expiry_hours', '72', 'number', 'Hours before an unaccepted bid expires'),
  ('escrow_release_delay_hrs', '48', 'number', 'Hours after job completion before escrow auto-releases'),
  ('min_helper_rating', '3.0', 'number', 'Minimum rating to appear in search results'),
  ('maintenance_mode', 'false', 'text', 'Set to true to enable site-wide maintenance mode'),
  ('new_user_registrations', 'true', 'text', 'Set to false to disable new signups'),
  ('require_id_verification', 'false', 'text', 'Require ID verification for all helpers'),
  ('support_email', 'support@oxsteed.com', 'text', 'Platform support email address')
ON CONFLICT (key) DO NOTHING;

-- Seed default feature flags
INSERT INTO feature_flags (key, is_enabled, description) VALUES
  ('escrow_payments', true, 'Enable escrow payment protection for Tier 3 jobs'),
  ('broker_matching', false, 'Enable automatic broker matching for complex jobs'),
  ('push_notifications', true, 'Enable push notifications for mobile users'),
  ('two_factor_auth', true, 'Allow users to enable 2FA on their accounts'),
  ('helper_background_checks', true, 'Require background checks for helper verification'),
  ('job_auto_assign', false, 'Auto-assign helpers to jobs based on matching algorithm'),
  ('referral_program', false, 'Enable referral code rewards program'),
  ('multi_language', false, 'Enable multi-language support (Spanish, etc.)'),
  ('stripe_identity', true, 'Enable Stripe Identity for ID verification'),
  ('waitlist_mode', false, 'Redirect new signups to waitlist instead of registration')
ON CONFLICT (key) DO NOTHING;
