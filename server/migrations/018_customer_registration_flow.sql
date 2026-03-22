-- ═══════════════════════════════════════════════════════════════
-- Migration 018: Customer Registration Flow
-- Adds: waitlist table, OTP lockout columns, zip_code on users,
--        age_confirmed flag, terms acceptance columns
-- OxSteed v2
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Add zip_code column to users ────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS zip_code VARCHAR(10) NULL;

-- ─── Age confirmation ────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age_confirmed BOOLEAN NOT NULL DEFAULT false;

-- ─── OTP lockout tracking ────────────────────────────────────
-- Tracks failed OTP attempts and lockout expiry
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS otp_attempts       INTEGER   NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS otp_locked_until   TIMESTAMPTZ NULL;

-- ─── Terms acceptance (legal record) ─────────────────────────
-- These four columns are the enforceable legal acceptance record.
-- NEVER remove or modify once populated.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_accepted_at      TIMESTAMPTZ NULL;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_version          VARCHAR(20) NULL;  -- e.g. '2026-03-20'
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_acceptance_ip    VARCHAR(45) NULL;  -- raw IP stored at acceptance time only
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_acceptance_ua    TEXT NULL;          -- User-Agent at acceptance time

-- ─── Pending registration tokens ─────────────────────────────
-- Stores form data between Step 1 and Step 3 so we don't create
-- the user record until email is verified.
CREATE TABLE IF NOT EXISTS pending_registrations (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  token           VARCHAR(64) NOT NULL UNIQUE,    -- random hex token passed to front-end
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(20)  NOT NULL,
  zip_code        VARCHAR(10)  NOT NULL,
  age_confirmed   BOOLEAN      NOT NULL DEFAULT false,
  -- Terms acceptance snapshot (captured at Step 2)
  terms_accepted_at   TIMESTAMPTZ NULL,
  terms_version       VARCHAR(20) NULL,
  terms_acceptance_ip VARCHAR(45) NULL,
  terms_acceptance_ua TEXT NULL,
  -- OTP
  otp_code        CHAR(6)      NULL,
  otp_expires_at  TIMESTAMPTZ  NULL,
  otp_attempts    INTEGER      NOT NULL DEFAULT 0,
  otp_locked_until TIMESTAMPTZ NULL,
  -- Expiry of the whole pending record (30 min TTL)
  expires_at      TIMESTAMPTZ  NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_reg_token ON pending_registrations(token);
CREATE INDEX IF NOT EXISTS idx_pending_reg_email ON pending_registrations(email);
CREATE INDEX IF NOT EXISTS idx_pending_reg_expiry ON pending_registrations(expires_at);

-- ─── Waitlist ─────────────────────────────────────────────────
-- Stores emails of users outside active markets who requested
-- to be notified when OxSteed launches in their area.
CREATE TABLE IF NOT EXISTS waitlist (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       VARCHAR(255) NOT NULL,
  zip_code    VARCHAR(10)  NOT NULL,
  source      VARCHAR(50)  NOT NULL DEFAULT 'registration', -- where they signed up
  ip_hash     VARCHAR(64)  NULL,                             -- SHA-256 of IP
  notified_at TIMESTAMPTZ NULL,                              -- when we emailed them
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, zip_code)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_email   ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_zip     ON waitlist(zip_code);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- END OF MIGRATION 018
-- Run: psql $DATABASE_URL -f migrations/018_customer_registration_flow.sql
-- ═══════════════════════════════════════════════════════════════
