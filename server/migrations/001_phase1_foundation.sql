-- ============================================================
-- PHASE 1: Legal & Structural Foundation
-- Migration 001 - Database Schema Changes
-- OxSteed v2
-- ============================================================

-- ─── Users Table — Add Fields ────────────────────────────────

ALTER TABLE users ADD COLUMN tier ENUM('tier1', 'tier2_basic', 'tier2_pro') DEFAULT 'tier1';
ALTER TABLE users ADD COLUMN role ENUM('customer', 'helper', 'both') NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN identity_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN background_check_status ENUM('none', 'pending', 'passed', 'failed') DEFAULT 'none';
ALTER TABLE users ADD COLUMN background_check_date TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN background_check_expiry TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN stripe_connected_account_id VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN subscription_id VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN subscription_status ENUM('none', 'active', 'past_due', 'cancelled') DEFAULT 'none';
ALTER TABLE users ADD COLUMN w9_on_file BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN w9_submitted_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN w9_data JSONB NULL;
ALTER TABLE users ADD COLUMN referral_code VARCHAR(50) UNIQUE NULL;
ALTER TABLE users ADD COLUMN referred_by VARCHAR(50) NULL;
ALTER TABLE users ADD COLUMN market_id INTEGER NULL;
ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN deactivation_reason TEXT NULL;

-- ─── New Table — Markets ─────────────────────────────────────

CREATE TABLE markets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  zip_codes TEXT[] NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  launched_at TIMESTAMP,
  license_operator_id INTEGER NULL,
  license_fee_monthly DECIMAL(10,2) NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO markets (name, state, zip_codes, active, launched_at)
VALUES ('Springfield, OH', 'OH', ARRAY['45501','45502','45503','45504','45505','45506'], TRUE, NOW());

-- ─── New Table — Subscriptions Log ───────────────────────────

CREATE TABLE subscription_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  event_type ENUM('created', 'upgraded', 'downgraded', 'cancelled', 'past_due', 'renewed') NOT NULL,
  from_tier VARCHAR(50) NULL,
  to_tier VARCHAR(50) NULL,
  stripe_subscription_id VARCHAR(255),
  stripe_event_id VARCHAR(255),
  mrr_impact DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─── New Table — W9 Records ──────────────────────────────────

CREATE TABLE w9_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  legal_name VARCHAR(255) NOT NULL,
  business_name VARCHAR(255) NULL,
  tax_classification VARCHAR(50) NOT NULL,
  ssn_last4 VARCHAR(4) NULL,
  tin_encrypted TEXT NOT NULL,
  tin_verified BOOLEAN DEFAULT FALSE,
  address TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  signed_at TIMESTAMP NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  year_applicable INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ─── Jobs Table — Add Fields ─────────────────────────────────

ALTER TABLE jobs ADD COLUMN tier ENUM('tier1', 'tier3') DEFAULT 'tier1';
ALTER TABLE jobs ADD COLUMN protection_fee_amount DECIMAL(10,2) NULL;
ALTER TABLE jobs ADD COLUMN protection_fee_rate DECIMAL(5,4) NULL;
ALTER TABLE jobs ADD COLUMN stripe_payment_intent_id VARCHAR(255) NULL;
ALTER TABLE jobs ADD COLUMN stripe_connected_account_id VARCHAR(255) NULL;
ALTER TABLE jobs ADD COLUMN escrow_status ENUM('none', 'held', 'released', 'refunded', 'disputed') DEFAULT 'none';
ALTER TABLE jobs ADD COLUMN escrow_held_at TIMESTAMP NULL;
ALTER TABLE jobs ADD COLUMN escrow_released_at TIMESTAMP NULL;
ALTER TABLE jobs ADD COLUMN completion_confirmed_at TIMESTAMP NULL;
ALTER TABLE jobs ADD COLUMN completion_confirmed_by INTEGER NULL;
ALTER TABLE jobs ADD COLUMN dispute_filed_at TIMESTAMP NULL;
ALTER TABLE jobs ADD COLUMN dispute_status ENUM('none', 'open', 'under_review', 'resolved_client', 'resolved_helper', 'dismissed') DEFAULT 'none';
ALTER TABLE jobs ADD COLUMN dispute_resolved_at TIMESTAMP NULL;
ALTER TABLE jobs ADD COLUMN auto_release_at TIMESTAMP NULL;
ALTER TABLE jobs ADD COLUMN market_id INTEGER REFERENCES markets(id);
ALTER TABLE jobs ADD COLUMN job_value DECIMAL(10,2) NULL;
ALTER TABLE jobs ADD COLUMN customer_total DECIMAL(10,2) NULL;
