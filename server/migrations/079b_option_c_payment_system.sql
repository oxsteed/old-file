-- Option C: Trust-Based Invoice Payment System

-- Owner payment method storage (one per owner)
CREATE TABLE owner_payment_methods (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('cash_app', 'venmo', 'bank_transfer')),
  payment_identifier VARCHAR(255) NOT NULL, -- Cash App $handle, Venmo @username, Bank account info
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payment_methods_owner ON owner_payment_methods(owner_id);

-- Invoices for tool rental bookings
CREATE TABLE tool_rental_invoices (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL UNIQUE REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) NOT NULL UNIQUE, -- Format: INV-YYYYMMDD-XXXXX
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

CREATE INDEX idx_invoices_booking ON tool_rental_invoices(booking_id);
CREATE INDEX idx_invoices_customer ON tool_rental_invoices(customer_id);
CREATE INDEX idx_invoices_owner ON tool_rental_invoices(owner_id);
CREATE INDEX idx_invoices_status ON tool_rental_invoices(status);
CREATE INDEX idx_invoices_invoice_number ON tool_rental_invoices(invoice_number);

-- Invoice delivery tracking (in-platform with read receipts)
CREATE TABLE invoice_delivery_log (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES tool_rental_invoices(id) ON DELETE CASCADE,
  delivery_method VARCHAR(50) NOT NULL CHECK (delivery_method IN ('in_platform', 'email')),
  recipient_email VARCHAR(255),
  sender_email VARCHAR(255), -- For email deliveries
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP, -- When customer read in-platform invoice
  delivery_status VARCHAR(50) DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','failed','delivered'))
);

CREATE INDEX idx_delivery_log_invoice ON invoice_delivery_log(invoice_id);
CREATE INDEX idx_delivery_log_method ON invoice_delivery_log(delivery_method);
CREATE INDEX idx_delivery_log_read ON invoice_delivery_log(read_at) WHERE read_at IS NOT NULL;

-- Tool rental terms acceptance (both parties must agree)
CREATE TABLE tool_rental_terms_acceptance (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_role VARCHAR(50) NOT NULL CHECK (user_role IN ('customer', 'owner')),
  terms_version VARCHAR(20) NOT NULL, -- e.g., "1.0"
  accepted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  CONSTRAINT unique_acceptance UNIQUE(booking_id, user_id)
);

CREATE INDEX idx_terms_booking ON tool_rental_terms_acceptance(booking_id);
CREATE INDEX idx_terms_user ON tool_rental_terms_acceptance(user_id);

-- User reports/flags for bad behavior
CREATE TABLE user_reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id BIGINT REFERENCES tool_rentals_bookings(id) ON DELETE SET NULL,
  report_type VARCHAR(100) NOT NULL, -- e.g., 'non_payment', 'tool_damage', 'non_return', 'fraud', 'other'
  description TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed','closed')),
  severity VARCHAR(50) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  platform_action VARCHAR(100), -- e.g., 'warning_sent', 'account_suspended', 'none'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX idx_reports_reporter ON user_reports(reporter_id);
CREATE INDEX idx_reports_user ON user_reports(reported_user_id);
CREATE INDEX idx_reports_status ON user_reports(status);
CREATE INDEX idx_reports_severity ON user_reports(severity);
CREATE INDEX idx_reports_booking ON user_reports(booking_id);

-- Update bookings status constraint to include new payment statuses
ALTER TABLE tool_rentals_bookings
DROP CONSTRAINT tool_rentals_bookings_status_check;

ALTER TABLE tool_rentals_bookings
ADD CONSTRAINT tool_rentals_bookings_status_check
CHECK (status IN ('pending','invoice_sent','payment_confirmed','completed','cancelled'));

-- Add invoice_sent_at and payment_confirmed_at columns to bookings
ALTER TABLE tool_rentals_bookings
ADD COLUMN invoice_sent_at TIMESTAMP,
ADD COLUMN payment_confirmed_at TIMESTAMP;
