
-- >>> BEGIN: 022_add_two_factor_auth.sql <<<
-- Migration 022: Add Two-Factor Authentication (TOTP)
-- OxSteed v2

BEGIN;

-- Add 2FA columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT[] NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_email VARCHAR(255) NULL;

-- Track 2FA setup attempts and failed verifications
CREATE TABLE IF NOT EXISTS two_factor_audit_log (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_2fa_audit_user_id ON two_factor_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_2fa_audit_action ON two_factor_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_2fa_audit_created ON two_factor_audit_log(created_at);

COMMIT;

-- >>> END: 022_add_two_factor_auth.sql <<<

-- >>> BEGIN: 023_create_platform_settings_and_feature_flags.sql <<<
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
  is_enabled BOOLEAN DEFAULT false,
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

-- >>> END: 023_create_platform_settings_and_feature_flags.sql <<<

-- >>> BEGIN: 024_create_messaging_tables.sql <<<
-- Migration 024: Create messaging tables (conversations and messages)

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'blocked')),
    last_message_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(job_id, customer_id, helper_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'attachment')),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: dispute_messages table is created in 015_phase4_create_disputes.sql

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_helper ON conversations(helper_id);
CREATE INDEX IF NOT EXISTS idx_conversations_job ON conversations(job_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(conversation_id, is_read) WHERE is_read = FALSE;

-- >>> END: 024_create_messaging_tables.sql <<<

-- >>> BEGIN: 025_merge_legacy_unique_fields.sql <<<
-- ===============================================================
-- Migration 025: Merge Legacy Unique Fields
-- Rescues unique columns/tables from old phase series (001-009)
-- that are NOT present in the clean series (001_initial_schema
-- through 024). All statements use IF NOT EXISTS / ADD COLUMN
-- IF NOT EXISTS so this is safe to run on any DB state.
-- OxSteed v2
-- ===============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- SECTION 1: Unique columns on users
-- (from 002_phase2_add_tier_fields_to_users.sql)
-- These were NOT included in 001_initial_schema.sql
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS community_score        DECIMAL(3,1)  DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS gl_insurance_verified  BOOLEAN       DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referral_reward_given  BOOLEAN       DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referrals_count        INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_conversions_count INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_role             VARCHAR(20)   DEFAULT NULL;

-- Note: idx_users_referral_code moved to 026_fix_auth_schema.sql
-- (referral_code column is added in that migration)
-- idx_users_market_id removed: market_id does not exist on the users table

-- ─────────────────────────────────────────────────────────────
-- SECTION 2: Unique columns on markets table
-- (from 003_phase2_create_markets.sql)
-- 001_initial_schema created markets but WITHOUT these columns
-- ─────────────────────────────────────────────────────────────

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS license_operator_id   INTEGER       NULL,
  ADD COLUMN IF NOT EXISTS license_fee_monthly   DECIMAL(10,2) NULL;

-- ─────────────────────────────────────────────────────────────
-- SECTION 3: Sessions table
-- (from 004_phase2_create_sessions.sql)
-- NOT present anywhere in the clean series (001-024)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id             SERIAL PRIMARY KEY,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  refresh_token  VARCHAR(255) NOT NULL,
  is_valid       BOOLEAN NOT NULL DEFAULT true,
  device_info    TEXT NULL,
  ip_address     VARCHAR(45) NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token);

-- ─────────────────────────────────────────────────────────────
-- SECTION 4: W9 Records table
-- (from 005_phase2_create_w9_records.sql)
-- 001_initial_schema has w9 columns on users but no standalone
-- w9_records table. This stores full tax documents securely.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS w9_records (
  id                  SERIAL PRIMARY KEY,
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  legal_name          VARCHAR(255) NOT NULL,
  business_name       VARCHAR(255) NULL,
  tax_classification  VARCHAR(50)  NOT NULL,
  ssn_last4           VARCHAR(4)   NULL,
  tin_encrypted       TEXT         NOT NULL,
  tin_verified        BOOLEAN      DEFAULT FALSE,
  address             TEXT         NOT NULL,
  signature_data      TEXT         NOT NULL,
  signed_at           TIMESTAMPTZ  NOT NULL,
  ip_address          VARCHAR(45)  NOT NULL,
  user_agent          TEXT         NULL,
  year_applicable     INTEGER      NOT NULL,
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_w9_user_id ON w9_records(user_id);
CREATE INDEX IF NOT EXISTS idx_w9_year   ON w9_records(year_applicable);

-- ─────────────────────────────────────────────────────────────
-- SECTION 5: Subscription Events log
-- (from 001_phase1_foundation.sql)
-- Tracks every subscription lifecycle event for MRR analysis
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_events (
  id                      SERIAL PRIMARY KEY,
  user_id                 UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type              VARCHAR(30) NOT NULL,
  -- created|upgraded|downgraded|cancelled|past_due|renewed
  from_tier               VARCHAR(50) NULL,
  to_tier                 VARCHAR(50) NULL,
  stripe_subscription_id  VARCHAR(255) NULL,
  stripe_event_id         VARCHAR(255) NULL,
  mrr_impact              DECIMAL(10,2) NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_user ON subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sub_events_created ON subscription_events(created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- SECTION 6: Introduction requests — richer columns
-- (from 006_phase2_create_introduction_requests.sql)
-- 001_initial_schema has intro_requests but missing fields:
-- scheduled_date, customer_budget, customer_phone_sent,
-- helper_phone_sent. Add them safely.
-- ─────────────────────────────────────────────────────────────

-- Create the table if it somehow doesn't exist yet
CREATE TABLE IF NOT EXISTS intro_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_description       TEXT NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  accepted_at           TIMESTAMPTZ,
  declined_at           TIMESTAMPTZ,
  contact_revealed_at   TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, helper_id)
);

-- Add unique columns from the legacy version
ALTER TABLE intro_requests
  ADD COLUMN IF NOT EXISTS scheduled_date       DATE         NULL,
  ADD COLUMN IF NOT EXISTS customer_budget      DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS customer_phone_sent  BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS helper_phone_sent    BOOLEAN      DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_intro_requests_customer ON intro_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_intro_requests_helper   ON intro_requests(helper_id);
CREATE INDEX IF NOT EXISTS idx_intro_requests_status   ON intro_requests(status);

-- ─────────────────────────────────────────────────────────────
-- SECTION 7: Reviews — moderation columns
-- (from 007_phase2_create_reviews.sql)
-- 001_initial_schema reviews table missing moderation fields:
-- flagged, flagged_reason, removed, removed_reason, removed_by
-- These are important for admin content moderation.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS flagged         BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flagged_reason  TEXT     NULL,
  ADD COLUMN IF NOT EXISTS removed         BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS removed_reason  TEXT     NULL,
  ADD COLUMN IF NOT EXISTS removed_by      UUID     REFERENCES users(id) NULL;

-- ─────────────────────────────────────────────────────────────
-- SECTION 8: Push subscriptions — active flag
-- (from 009_phase2_create_push_subscriptions.sql)
-- 001_initial_schema push_subscriptions table missing
-- the 'active' column used to soft-disable a subscription
-- ─────────────────────────────────────────────────────────────

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_push_subs_active
  ON push_subscriptions(user_id) WHERE active = true;

-- ─────────────────────────────────────────────────────────────
-- SECTION 9: Notification preferences table
-- (from 006_notifications_reviews_disputes.sql)
-- This granular per-user preferences table is NOT in 001 or
-- any clean series file. Important for the notifications system.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- In-app
  in_app_new_bid           BOOLEAN DEFAULT true,
  in_app_bid_accepted      BOOLEAN DEFAULT true,
  in_app_job_started       BOOLEAN DEFAULT true,
  in_app_job_completed     BOOLEAN DEFAULT true,
  in_app_payment_released  BOOLEAN DEFAULT true,
  in_app_new_review        BOOLEAN DEFAULT true,
  in_app_dispute_update    BOOLEAN DEFAULT true,
  in_app_subscription      BOOLEAN DEFAULT true,
  -- Push
  push_new_job_nearby      BOOLEAN DEFAULT true,
  push_new_bid             BOOLEAN DEFAULT true,
  push_bid_accepted        BOOLEAN DEFAULT true,
  push_payment_released    BOOLEAN DEFAULT true,
  push_dispute_update      BOOLEAN DEFAULT true,
  -- Email
  email_bid_accepted       BOOLEAN DEFAULT true,
  email_payment_released   BOOLEAN DEFAULT true,
  email_subscription       BOOLEAN DEFAULT true,
  email_dispute_update     BOOLEAN DEFAULT true,
  email_weekly_summary     BOOLEAN DEFAULT true,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id);

-- ─────────────────────────────────────────────────────────────
-- SECTION 10: Dispute evidence + dispute messages tables
-- (from 006_notifications_reviews_disputes.sql)
-- The clean series 015_phase4_create_disputes.sql may not have
-- these sub-tables. Adding them safely.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      INTEGER REFERENCES disputes(id) ON DELETE CASCADE,
  submitted_by    UUID REFERENCES users(id) ON DELETE CASCADE,
  submitter_role  VARCHAR(20) NOT NULL, -- 'client'|'helper'|'admin'
  type            VARCHAR(20) DEFAULT 'text', -- 'text'|'image'|'video'|'document'
  content         TEXT,
  file_url        TEXT,
  file_name       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_dispute ON dispute_evidence(dispute_id);

CREATE TABLE IF NOT EXISTS dispute_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      INTEGER REFERENCES disputes(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  sender_role     VARCHAR(20) NOT NULL, -- 'client'|'helper'|'admin'
  message         TEXT NOT NULL,
  is_admin_only   BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_messages ON dispute_messages(dispute_id, created_at ASC);

-- ─────────────────────────────────────────────────────────────
-- SECTION 11: Updated_at trigger for new tables
-- ─────────────────────────────────────────────────────────────

-- Trigger for notification_preferences
DO $$ BEGIN
  CREATE TRIGGER trg_notif_prefs_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- ===============================================================
-- END OF MIGRATION 025
-- This file replaces:
--   001_phase1_foundation.sql
--   002_phase2_add_tier_fields_to_users.sql
--   003_phase2_create_markets.sql
--   004_phase2_create_sessions.sql
--   005_phase2_create_w9_records.sql
--   006_notifications_reviews_disputes.sql
--   006_phase2_create_introduction_requests.sql
--   007_phase2_create_reviews.sql
--   008_phase2_create_notifications.sql
--   009_phase2_create_push_subscriptions.sql
-- Those files should be DELETED after this migration is confirmed.
-- ===============================================================

-- >>> END: 025_merge_legacy_unique_fields.sql <<<

-- >>> BEGIN: 026_fix_auth_schema.sql <<<
-- Migration 026: Fix auth schema - add sessions table and missing user columns
-- These columns/tables are required by authController.js

-- Sessions table for refresh token management
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Missing columns on users table referenced by authController.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
  ON users(referral_code) WHERE referral_code IS NOT NULL;

-- >>> END: 026_fix_auth_schema.sql <<<

-- >>> BEGIN: 026b_add_tier_to_users.sql <<<
-- Migration 026: Add tier column to users table
-- The auth controller references users.tier in login, register,
-- refresh, and profile queries, but the column only exists on
-- helper_profiles. This adds it to users with a safe default.
-- OxSteed v2

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'free';

COMMIT;

-- >>> END: 026b_add_tier_to_users.sql <<<

-- >>> BEGIN: 027_drop_unused_refresh_tokens.sql <<<
-- Drop the unused refresh_tokens table from 001
-- authController.js uses the 'sessions' table instead
DROP TABLE IF EXISTS refresh_tokens;

-- >>> END: 027_drop_unused_refresh_tokens.sql <<<
