-- Phase 2: Migration 004 - Create w9_records table
-- OxSteed v2

BEGIN;

CREATE TABLE IF NOT EXISTS w9_records (
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
  signed_at TIMESTAMPTZ NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT NULL,
  year_applicable INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_w9_user_id ON w9_records(user_id);
CREATE INDEX IF NOT EXISTS idx_w9_year ON w9_records(year_applicable);

COMMIT;
