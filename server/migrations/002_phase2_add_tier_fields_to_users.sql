-- Phase 2: Migration 001 - Add tier fields to users
-- OxSteed v2

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'tier1',
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS background_check_status VARCHAR(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS background_check_date TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS background_check_expiry TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS stripe_connected_account_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS subscription_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS w9_on_file BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS w9_submitted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS referred_by VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS market_id INTEGER NULL,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS community_score DECIMAL(3,1) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS jobs_completed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_response_time INTEGER NULL,
  ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS availability_days TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_radius INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS typical_rate DECIMAL(8,2) NULL,
  ADD COLUMN IF NOT EXISTS rate_type VARCHAR(20) DEFAULT 'per_job',
  ADD COLUMN IF NOT EXISTS headline VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS intro_video_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS gl_insurance_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referral_reward_given BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referrals_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_conversions_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS terms_acceptance_ip VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS admin_role VARCHAR(20) DEFAULT NULL;

-- Backfill existing users
UPDATE users SET
  tier = 'tier1',
  role = 'both',
  community_score = 5.0,
  terms_version = '2026-03-20'
WHERE tier IS NULL;

-- Unique index on referral_code
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
  ON users(referral_code) WHERE referral_code IS NOT NULL;

-- Index for market queries
CREATE INDEX IF NOT EXISTS idx_users_market_id ON users(market_id);

-- Index for tier queries (profile feed)
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);

COMMIT;
