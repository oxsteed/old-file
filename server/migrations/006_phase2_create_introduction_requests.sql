-- Phase 2: Migration 005 - Create introduction_requests table
-- OxSteed v2

BEGIN;

CREATE TABLE IF NOT EXISTS introduction_requests (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES users(id),
  helper_id INTEGER REFERENCES users(id),
  task_description TEXT NOT NULL,
  scheduled_date DATE NULL,
  customer_budget DECIMAL(10,2) NULL,
  status VARCHAR(20) DEFAULT 'pending',
  contact_exchanged_at TIMESTAMPTZ NULL,
  customer_phone_sent BOOLEAN DEFAULT FALSE,
  helper_phone_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT chk_status CHECK (status IN ('pending','connected','declined','expired','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_intro_customer ON introduction_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_intro_helper ON introduction_requests(helper_id);
CREATE INDEX IF NOT EXISTS idx_intro_status ON introduction_requests(status);

COMMIT;
