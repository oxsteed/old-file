
-- >>> BEGIN: 078b_tool_enhancements.sql <<<
-- Tool rentals enhancements
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS image_gallery TEXT[] DEFAULT '{}';
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2) DEFAULT 0;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS views_count INT DEFAULT 0;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS favorites_count INT DEFAULT 0;

-- Owner response time (hours)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_response_time_hours INT DEFAULT 24;

-- SEO metadata
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS seo_slug VARCHAR(255) UNIQUE;
ALTER TABLE tool_rentals ADD COLUMN IF NOT EXISTS seo_keywords TEXT;

CREATE INDEX idx_tool_avg_rating ON tool_rentals(avg_rating DESC);
CREATE INDEX idx_tool_views ON tool_rentals(views_count DESC);

-- >>> END: 078b_tool_enhancements.sql <<<

-- >>> BEGIN: 079_business_skills.sql <<<
-- Phase 7: Business Skills Integration
-- Create table to track skills required by each business

CREATE TABLE IF NOT EXISTS business_skills (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills_lookup(id) ON DELETE RESTRICT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  min_years_experience SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, skill_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_business_skills_business_id ON business_skills(business_id);
CREATE INDEX IF NOT EXISTS idx_business_skills_skill_id ON business_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_business_skills_required ON business_skills(is_required) WHERE is_required = true;

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_business_skills_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_business_skills_timestamp_trigger ON business_skills;
CREATE TRIGGER update_business_skills_timestamp_trigger
BEFORE UPDATE ON business_skills
FOR EACH ROW
EXECUTE FUNCTION update_business_skills_timestamp();

-- >>> END: 079_business_skills.sql <<<

-- >>> BEGIN: 079b_option_c_payment_system.sql <<<
-- Option C: Trust-Based Invoice Payment System

-- Owner payment method storage (one per owner)
CREATE TABLE IF NOT EXISTS owner_payment_methods (
  id BIGSERIAL PRIMARY KEY,
  owner_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('cash_app', 'venmo', 'bank_transfer')),
  payment_identifier VARCHAR(255) NOT NULL, -- Cash App $handle, Venmo @username, Bank account info
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_owner
  ON owner_payment_methods(owner_id);

-- Invoices for tool rental bookings
CREATE TABLE IF NOT EXISTS tool_rental_invoices (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL UNIQUE REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) NOT NULL UNIQUE, -- Format: INV-YYYYMMDD-XXXXX
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,

  -- Invoice details
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  daily_rate DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,

  -- Payment method snapshot (captured at invoice time)
  payment_type VARCHAR(50) NOT NULL,
  payment_identifier VARCHAR(255) NOT NULL,

  -- Status
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','payment_confirmed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  payment_confirmed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_booking
  ON tool_rental_invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer
  ON tool_rental_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_owner
  ON tool_rental_invoices(owner_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON tool_rental_invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number
  ON tool_rental_invoices(invoice_number);

-- Invoice delivery tracking (in-platform with read receipts)
CREATE TABLE IF NOT EXISTS invoice_delivery_log (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES tool_rental_invoices(id) ON DELETE CASCADE,
  delivery_method VARCHAR(50) NOT NULL CHECK (delivery_method IN ('in_platform', 'email')),
  recipient_email VARCHAR(255),
  sender_email VARCHAR(255), -- For email deliveries
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP, -- When customer read in-platform invoice
  delivery_status VARCHAR(50) DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','sent','failed','delivered'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_log_invoice
  ON invoice_delivery_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_delivery_log_method
  ON invoice_delivery_log(delivery_method);
CREATE INDEX IF NOT EXISTS idx_delivery_log_read
  ON invoice_delivery_log(read_at) WHERE read_at IS NOT NULL;

-- Tool rental terms acceptance (both parties must agree)
CREATE TABLE IF NOT EXISTS tool_rental_terms_acceptance (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_role VARCHAR(50) NOT NULL CHECK (user_role IN ('customer', 'owner')),
  terms_version VARCHAR(20) NOT NULL, -- e.g., "1.0"
  accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  CONSTRAINT unique_acceptance UNIQUE (booking_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_terms_booking
  ON tool_rental_terms_acceptance(booking_id);
CREATE INDEX IF NOT EXISTS idx_terms_user
  ON tool_rental_terms_acceptance(user_id);

-- User reports/flags for bad behavior
CREATE TABLE IF NOT EXISTS user_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id BIGINT REFERENCES tool_rentals_bookings(id) ON DELETE SET NULL,
  report_type VARCHAR(100) NOT NULL, -- e.g., 'non_payment', 'tool_damage', 'non_return', 'fraud', 'other'
  description TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'open'
    CHECK (status IN ('open','investigating','resolved','dismissed','closed')),
  severity VARCHAR(50) DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  platform_action VARCHAR(100), -- e.g., 'warning_sent', 'account_suspended', 'none'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter
  ON user_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_user
  ON user_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status
  ON user_reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_severity
  ON user_reports(severity);
CREATE INDEX IF NOT EXISTS idx_reports_booking
  ON user_reports(booking_id);

-- Update bookings status constraint to include new payment statuses
ALTER TABLE tool_rentals_bookings
  DROP CONSTRAINT IF EXISTS tool_rentals_bookings_status_check;

ALTER TABLE tool_rentals_bookings
  ADD CONSTRAINT tool_rentals_bookings_status_check
  CHECK (status IN ('pending','invoice_sent','payment_confirmed','completed','cancelled'));

-- Add invoice_sent_at and payment_confirmed_at columns to bookings
ALTER TABLE tool_rentals_bookings
  ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMP;

-- >>> END: 079b_option_c_payment_system.sql <<<

-- >>> BEGIN: 080_job_required_skills.sql <<<
-- Extend jobs table to support required skills
-- Denormalize both full skill objects (JSONB) and IDs (INT[]) for efficient filtering

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]' CHECK (jsonb_typeof(required_skills) = 'array'),
  ADD COLUMN IF NOT EXISTS skill_ids INT[] DEFAULT '{}';

-- GIN index for efficient array containment queries (WHERE skill_ids @> '{123,456}')
CREATE INDEX IF NOT EXISTS idx_jobs_skill_ids ON jobs USING GIN(skill_ids);

-- Comment for clarity
COMMENT ON COLUMN jobs.required_skills IS 'Array of {id, name, min_years_experience, is_required} objects';
COMMENT ON COLUMN jobs.skill_ids IS 'Array of skill_lookup.id values for efficient filtering; mirrors required_skills[].id';

-- >>> END: 080_job_required_skills.sql <<<

-- >>> BEGIN: 081_invoice_idempotency.sql <<<
-- Add idempotency protection to invoice creation
-- Prevents duplicate invoices if request is retried after network failure

ALTER TABLE tool_rental_invoices
ADD COLUMN idempotency_key VARCHAR(64) UNIQUE;

-- Create index for efficient lookup
CREATE INDEX idx_invoices_idempotency_key ON tool_rental_invoices(idempotency_key);

-- Create unique constraint on booking_id + idempotency_key to prevent duplicates per booking
ALTER TABLE tool_rental_invoices
ADD CONSTRAINT invoice_idempotency_per_booking UNIQUE(booking_id, idempotency_key);

-- >>> END: 081_invoice_idempotency.sql <<<

-- >>> BEGIN: 082_invoice_email_delivery.sql <<<
-- Add email delivery tracking columns to invoice_delivery_log
-- Supports tracking actual email send success/failure with error details

ALTER TABLE invoice_delivery_log
ADD COLUMN email_sent_at TIMESTAMP DEFAULT NULL;

ALTER TABLE invoice_delivery_log
ADD COLUMN email_delivery_errors TEXT DEFAULT NULL;

-- Create index for filtering failed deliveries
CREATE INDEX idx_invoice_delivery_log_status ON invoice_delivery_log(delivery_status)
WHERE delivery_status = 'failed';

-- Create index for email delivery tracking
CREATE INDEX idx_invoice_delivery_log_email_sent ON invoice_delivery_log(email_sent_at DESC)
WHERE email_sent_at IS NOT NULL;

-- >>> END: 082_invoice_email_delivery.sql <<<
