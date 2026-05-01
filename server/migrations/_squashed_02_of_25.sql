
-- >>> BEGIN: 015_phase4_create_disputes.sql <<<
-- Phase 4: Disputes table for conflict resolution
-- Supports dispute lifecycle between poster and helper

CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id),
  raised_by UUID NOT NULL REFERENCES users(id),
  against_user UUID NOT NULL REFERENCES users(id),
  reason VARCHAR(100) NOT NULL,
  -- quality, no_show, incomplete, overcharge, damage, other
  description TEXT NOT NULL,
  evidence JSONB DEFAULT '[]',
  -- array of { type, url, description }
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  -- open, under_review, resolved_poster, resolved_helper, escalated, closed
  resolution TEXT,
  resolution_type VARCHAR(30),
  -- refund_full, refund_partial, no_refund, mutual_agreement, admin_decision
  resolved_by UUID REFERENCES users(id),
  refund_amount NUMERIC(10, 2),
  admin_notes TEXT,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dispute messages for back-and-forth communication
CREATE TABLE IF NOT EXISTS dispute_messages (
  id SERIAL PRIMARY KEY,
  dispute_id INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_disputes_job_id ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON disputes(raised_by);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_payment_id ON disputes(payment_id);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON dispute_messages(dispute_id);

-- >>> END: 015_phase4_create_disputes.sql <<<

-- >>> BEGIN: 016_phase5_create_moderation_queue.sql <<<
-- Phase 5: Create moderation_queue table for admin review management

BEGIN;

CREATE TABLE IF NOT EXISTS moderation_queue (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL, -- 'review_flag', 'user_report', 'content_flag'
  target_id TEXT NOT NULL,
  target_type VARCHAR(50) NOT NULL, -- 'review', 'user', 'job'
  reported_by UUID REFERENCES users(id),
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'dismissed'
  assigned_to UUID REFERENCES users(id) NULL,
  resolution TEXT NULL,
  resolved_by UUID REFERENCES users(id) NULL,
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
  admin_id UUID REFERENCES users(id) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id TEXT NOT NULL,
  details JSONB NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;

-- >>> END: 016_phase5_create_moderation_queue.sql <<<

-- >>> BEGIN: 017_phase6_fee_config.sql <<<
BEGIN;

-- ——— Platform Fee Configuration ———————————————————————
-- Single source of truth for all runtime fee rates.
-- Super admin can update these from the dashboard.
-- feeCalculator.js reads from this table when present,
-- falls back to hardcoded constants if table is empty.

    CREATE TABLE IF NOT EXISTS fee_config (
  id              SERIAL       PRIMARY KEY,
  key             VARCHAR(100) NOT NULL UNIQUE,
  value           DECIMAL(10,4) NOT NULL,
  value_type      VARCHAR(20)  NOT NULL DEFAULT 'percentage',
  -- 'percentage' (0.10 = 10%) | 'cents' (500 = $5.00) | 'flat_dollars'
  label           VARCHAR(255) NOT NULL,
  description     TEXT,
  min_value       DECIMAL(10,4),
  max_value       DECIMAL(10,4),
  updated_by      UUID         REFERENCES users(id),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Seed default values matching feeCalculator.js constants
INSERT INTO fee_config
  (key, value, value_type, label, description, min_value, max_value)
VALUES
  ('tier3_platform_fee_pct',
    0.10,
    'percentage',
    'Tier 3 Platform Service Fee',
    'Percentage of job value charged as OxSteed platform fee. Applied to all Tier 3 protected transactions.',
    0.05,
    0.25),

  ('tier3_platform_fee_min_cents',
    500,
    'cents',
    'Tier 3 Minimum Platform Fee',
    'Minimum platform fee in cents regardless of job value. $5.00 = 500.',
    100,
    2000),

  ('tier3_protection_fee_pct',
    0.02,
    'percentage',
    'Payment Protection Fee',
    'Percentage charged to cover Stripe processing and escrow administration.',
    0.01,
    0.05),

  ('tier3_broker_cut_pct',
    0.05,
    'percentage',
    'Broker Mediation Fee',
    'Additional percentage taken when a Broker Helper mediates the transaction.',
    0.00,
    0.15),

  ('tier2_subscription_cents',
    2900,
    'cents',
    'Pro Subscription Monthly Price',
    'Monthly subscription price for Tier 2 (Pro) helpers in cents. $29.00 = 2900. Changes sync to Stripe.',
    999,
    9999),

  ('tier3_subscription_cents',
    7900,
    'cents',
    'Broker Subscription Monthly Price',
    'Monthly subscription price for Tier 3 (Broker) helpers in cents. $79.00 = 7900. Changes sync to Stripe.',
    2900,
    29900)
  ON CONFLICT (key) DO NOTHING;

-- ——— Fee Change History ———————————————————————————
-- Immutable log of every price change. Never delete.
  CREATE TABLE IF NOT EXISTS fee_change_log (
  id            BIGSERIAL   PRIMARY KEY,
  config_key    VARCHAR(100) NOT NULL,
  old_value     DECIMAL(10,4) NOT NULL,
  new_value     DECIMAL(10,4) NOT NULL,
  changed_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT,
  ip_hash       VARCHAR(64),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

  CREATE INDEX IF NOT EXISTS idx_fee_change_log_key    ON fee_change_log(config_key);
  CREATE INDEX IF NOT EXISTS idx_fee_change_log_created ON fee_change_log(created_at DESC);

-- Prevent deletion of fee history (safe if rule already exists)
DO $$ BEGIN
  CREATE RULE fee_log_no_delete AS ON DELETE TO fee_change_log
  DO INSTEAD NOTHING;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMIT;

-- >>> END: 017_phase6_fee_config.sql <<<

-- >>> BEGIN: 018_customer_registration_flow.sql <<<
-- ===============================================================
-- Migration 018: Customer Registration Flow
-- Adds: waitlist table, OTP lockout columns, zip_code on users,
--       age_confirmed flag, terms acceptance columns
-- OxSteed v2
-- ===============================================================

BEGIN;

-- --- Add zip_code column to users ---
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zip_code VARCHAR(10) NULL;

-- --- Age confirmation ---
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age_confirmed BOOLEAN NOT NULL DEFAULT false;

-- --- OTP lockout tracking ---
-- Tracks failed OTP attempts and lockout expiry
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS otp_attempts     INTEGER   NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS otp_locked_until  TIMESTAMPTZ NULL;

-- --- Terms acceptance (legal record) ---
-- These four columns are the enforceable legal acceptance record.
-- NEVER remove or modify once populated.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at    TIMESTAMPTZ NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_version         VARCHAR(20) NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_acceptance_ip   VARCHAR(45) NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_acceptance_ua   TEXT NULL;

-- --- Pending registration tokens ---
CREATE TABLE IF NOT EXISTS pending_registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           VARCHAR(64) NOT NULL UNIQUE,
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  zip_code        VARCHAR(10) NOT NULL,
  age_confirmed   BOOLEAN NOT NULL DEFAULT false,
  -- Terms acceptance snapshot (captured at Step 2)
  terms_accepted_at    TIMESTAMPTZ NULL,
  terms_version        VARCHAR(20) NULL,
  terms_acceptance_ip  VARCHAR(45) NULL,
  terms_acceptance_ua  TEXT NULL,
  -- OTP
  otp_code         CHAR(6) NULL,
  otp_expires_at   TIMESTAMPTZ NULL,
  otp_attempts     INTEGER NOT NULL DEFAULT 0,
  otp_locked_until TIMESTAMPTZ NULL,
  -- Expiry of the whole pending record (30 min TTL)
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_reg_token  ON pending_registrations(token);
CREATE INDEX IF NOT EXISTS idx_pending_reg_email  ON pending_registrations(email);
CREATE INDEX IF NOT EXISTS idx_pending_reg_expiry ON pending_registrations(expires_at);

-- --- Waitlist ---
CREATE TABLE IF NOT EXISTS waitlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL,
  zip_code    VARCHAR(10) NOT NULL,
  source      VARCHAR(50) NOT NULL DEFAULT 'registration',
  ip_hash     VARCHAR(64) NULL,
  notified_at TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, zip_code)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_email   ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_zip     ON waitlist(zip_code);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);

COMMIT;

-- ===============================================================
-- END OF MIGRATION 018
-- Run: psql $DATABASE_URL -f migrations/018_customer_registration_flow.sql
-- ===============================================================

-- >>> END: 018_customer_registration_flow.sql <<<

-- >>> BEGIN: 019_helper_registration.sql <<<
-- ===============================================================
-- Migration 019: Helper Registration Flow (Legacy DB Compatible)
-- Creates: helper_profiles, categories, helper_skills
-- Adds: role to pending_registrations, profile fields
-- Compatible with UUID users.id
-- OxSteed v2
-- ===============================================================

BEGIN;

-- ---- Add role to pending_registrations -----
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'customer';

-- ---- Add profile fields to pending_registrations ----
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(280),
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS service_categories TEXT[],
  ADD COLUMN IF NOT EXISTS availability_json JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_radius INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(20) DEFAULT 'per_job',
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(8,2),
  ADD COLUMN IF NOT EXISTS selected_tier VARCHAR(20) DEFAULT 'free';

-- ---- Create categories if not exists ----
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES categories(id),
  icon VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default categories
INSERT INTO categories (name, slug, icon, sort_order) VALUES
  ('Home Cleaning', 'home-cleaning', 'spray-can', 1),
  ('Lawn & Garden', 'lawn-garden', 'leaf', 2),
  ('Moving & Hauling', 'moving-hauling', 'truck', 3),
  ('Handyman', 'handyman', 'wrench', 4),
  ('Painting', 'painting', 'paintbrush', 5),
  ('Plumbing', 'plumbing', 'droplet', 6),
  ('Electrical', 'electrical', 'zap', 7),
  ('Auto Repair', 'auto-repair', 'car', 8),
  ('Pet Care', 'pet-care', 'heart', 9),
  ('Tutoring', 'tutoring', 'book-open', 10),
  ('Personal Training', 'personal-training', 'dumbbell', 11),
  ('Tech Support', 'tech-support', 'monitor', 12),
  ('Photography', 'photography', 'camera', 13),
  ('Event Planning', 'event-planning', 'calendar', 14),
  ('Delivery & Errands', 'delivery-errands', 'package', 15),
  ('General Labor', 'general-labor', 'hard-hat', 16)
ON CONFLICT (slug) DO NOTHING;

-- ---- Create helper_profiles (UUID FK to match users.id type) ----
CREATE TABLE IF NOT EXISTS helper_profiles (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier VARCHAR(20) NOT NULL DEFAULT 'free',
  profile_headline VARCHAR(280),
  bio_short VARCHAR(280),
  bio_long TEXT,
  profile_photo_url TEXT,
  service_city VARCHAR(100),
  service_state CHAR(2),
  service_zip VARCHAR(10),
  service_radius_miles INTEGER NOT NULL DEFAULT 10,
  service_lat DECIMAL(10,7),
  service_lng DECIMAL(10,7),
  hourly_rate_min DECIMAL(8,2),
  hourly_rate_max DECIMAL(8,2),
  flat_rate_available BOOLEAN NOT NULL DEFAULT false,
  contact_for_pricing BOOLEAN NOT NULL DEFAULT false,
  avg_rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  completed_jobs_count INTEGER NOT NULL DEFAULT 0,
  response_time_hours DECIMAL(5,2),
  is_background_checked BOOLEAN NOT NULL DEFAULT false,
  is_identity_verified BOOLEAN NOT NULL DEFAULT false,
  is_insured BOOLEAN NOT NULL DEFAULT false,
  is_licensed BOOLEAN NOT NULL DEFAULT false,
  insurance_details TEXT,
  license_details TEXT,
  availability_json JSONB NOT NULL DEFAULT '{}',
  is_available_now BOOLEAN NOT NULL DEFAULT false,
  stripe_account_id VARCHAR(255) UNIQUE,
  stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false,
  stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  stripe_onboarded_at TIMESTAMPTZ,
  market_id INTEGER REFERENCES markets(id),
  profile_views INTEGER NOT NULL DEFAULT 0,
  search_rank_boost DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  rate_preference VARCHAR(20) DEFAULT 'per_job',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helper_profiles_user ON helper_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_helper_profiles_tier ON helper_profiles(tier);
CREATE INDEX IF NOT EXISTS idx_helper_profiles_rating ON helper_profiles(avg_rating DESC);
CREATE INDEX IF NOT EXISTS idx_helper_profiles_market ON helper_profiles(market_id);

-- ---- Create helper_skills (UUID FK to match users.id type) ----
CREATE TABLE IF NOT EXISTS helper_skills (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  skill_name VARCHAR(100) NOT NULL,
  years_exp INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_helper_skills_user ON helper_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_helper_skills_category ON helper_skills(category_id);

COMMIT;

-- >>> END: 019_helper_registration.sql <<<

-- >>> BEGIN: 020_add_consent_indexes.sql <<<
-- Phase 7: Add indexes and ensure user_consents table exists for re-accept gate
-- This migration ensures the consent system is optimized for version checking.
-- Also adds deleted_at column to users table for soft-delete (CCPA compliance).

-- Add deleted_at column to users table for soft-delete support
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Ensure user_consents table exists (idempotent)
CREATE TABLE IF NOT EXISTS user_consents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type  VARCHAR(50) NOT NULL,
    version       VARCHAR(20) NOT NULL,
    ip_hash       VARCHAR(64),
    user_agent    TEXT,
    accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast consent status lookups (used by middleware & routes)
CREATE INDEX IF NOT EXISTS idx_user_consents_user_type
        ON user_consents (user_id, consent_type, accepted_at DESC);

-- Index for admin audit queries
CREATE INDEX IF NOT EXISTS idx_user_consents_type_version
        ON user_consents (consent_type, version);

-- >>> END: 020_add_consent_indexes.sql <<<

-- >>> BEGIN: 021_create_platform_config.sql <<<
-- Platform config key-value store for admin-editable settings
CREATE TABLE IF NOT EXISTS platform_config (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default tier pricing
INSERT INTO platform_config (key, value) VALUES
  ('tier1_price', '0'),
  ('tier1_label', 'Free'),
  ('tier2_price', '19.99'),
  ('tier2_label', '/month'),
  ('tier3_price', 'up to 17%'),
  ('tier3_label', 'per transaction')
ON CONFLICT (key) DO NOTHING;

-- >>> END: 021_create_platform_config.sql <<<
