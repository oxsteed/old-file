-- Migration 375: OxSteed Direct portal
-- Extends quote requests into a company-run service flow with Direct-specific
-- status tracking, payment proof, settings, locations, and message history.

ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quote_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS quote_currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS preferred_date DATE,
  ADD COLUMN IF NOT EXISTS preferred_time_window VARCHAR(80),
  ADD COLUMN IF NOT EXISTS service_address TEXT,
  ADD COLUMN IF NOT EXISTS service_city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS on_site_contact_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS on_site_contact_phone VARCHAR(40),
  ADD COLUMN IF NOT EXISTS access_notes TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(24) NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40),
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS proof_attachment JSONB,
  ADD COLUMN IF NOT EXISTS proof_link TEXT,
  ADD COLUMN IF NOT EXISTS proof_received_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_requests_status_check'
      AND conrelid = 'quote_requests'::regclass
  ) THEN
    ALTER TABLE quote_requests DROP CONSTRAINT quote_requests_status_check;
  END IF;
END $$;

ALTER TABLE quote_requests
  ADD CONSTRAINT quote_requests_status_check
  CHECK (status IN (
    'new',
    'reviewing',
    'quoted',
    'contacted',
    'accepted',
    'scheduled',
    'en_route',
    'started',
    'waiting_customer',
    'completed',
    'closed',
    'cancelled'
  ));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_requests_payment_status_check'
      AND conrelid = 'quote_requests'::regclass
  ) THEN
    ALTER TABLE quote_requests DROP CONSTRAINT quote_requests_payment_status_check;
  END IF;
END $$;

ALTER TABLE quote_requests
  ADD CONSTRAINT quote_requests_payment_status_check
  CHECK (payment_status IN (
    'unpaid',
    'proof_submitted',
    'confirmed',
    'partially_paid',
    'paid',
    'disputed',
    'refunded',
    'cancelled'
  ));

CREATE INDEX IF NOT EXISTS idx_quote_requests_payment_status
  ON quote_requests (payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_requests_scheduled_start
  ON quote_requests (scheduled_start_at)
  WHERE scheduled_start_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS direct_service_profiles (
  id BIGSERIAL PRIMARY KEY,
  company_name VARCHAR(200) NOT NULL DEFAULT 'OxSteed',
  headline VARCHAR(240) NOT NULL DEFAULT 'Food, tools, and local service work under one company.',
  minimum_price_cents INTEGER NOT NULL DEFAULT 10000,
  availability_text VARCHAR(200) NOT NULL DEFAULT 'Monday through Thursday',
  base_city VARCHAR(120) NOT NULL DEFAULT 'Springfield, OH',
  public_note TEXT,
  service_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  travel_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  travel_cities JSONB NOT NULL DEFAULT '[]'::jsonb,
  support_email VARCHAR(255),
  support_phone VARCHAR(40),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO direct_service_profiles (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS direct_customer_locations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(120) NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city VARCHAR(120) NOT NULL,
  region VARCHAR(120),
  postal_code VARCHAR(20),
  country_code VARCHAR(2) NOT NULL DEFAULT 'US',
  notes TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_customer_locations_user_created
  ON direct_customer_locations (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_customer_locations_default
  ON direct_customer_locations (user_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS direct_request_messages (
  id BIGSERIAL PRIMARY KEY,
  quote_request_id BIGINT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_role VARCHAR(40) NOT NULL DEFAULT 'customer',
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_request_messages_request_created
  ON direct_request_messages (quote_request_id, created_at ASC);

CREATE TABLE IF NOT EXISTS direct_request_events (
  id BIGSERIAL PRIMARY KEY,
  quote_request_id BIGINT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(40) NOT NULL DEFAULT 'system',
  event_type VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  details TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_request_events_request_created
  ON direct_request_events (quote_request_id, created_at ASC);
