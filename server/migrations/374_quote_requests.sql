-- Migration 374: Public quote requests
-- Simple public quote request system for OxSteed home/services.

CREATE TABLE IF NOT EXISTS quote_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(40),
  company_name VARCHAR(200),
  service_category VARCHAR(120) NOT NULL,
  service_location VARCHAR(200) NOT NULL,
  budget_range VARCHAR(80),
  timeline VARCHAR(120),
  preferred_contact_method VARCHAR(20) NOT NULL DEFAULT 'email'
    CHECK (preferred_contact_method IN ('email', 'phone', 'text', 'either')),
  details TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'quoted', 'contacted', 'closed', 'cancelled')),
  admin_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quote_requests_status_created
  ON quote_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_requests_email_created
  ON quote_requests (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_requests_user_created
  ON quote_requests (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
