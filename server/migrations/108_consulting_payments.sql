-- Migration 108: Consulting payments and pricing

CREATE TABLE IF NOT EXISTS consulting_packages (
  id SERIAL PRIMARY KEY,
  service_tier VARCHAR(50) NOT NULL,
  package_name VARCHAR(100) NOT NULL,
  description TEXT,
  base_price INT NOT NULL, -- in cents
  duration_hours INT,
  includes_deliverables BOOLEAN DEFAULT FALSE,
  max_revisions INT DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consulting_payments (
  id BIGSERIAL PRIMARY KEY,
  session_scheduled_id BIGINT REFERENCES consulting_sessions_scheduled(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL,
  service_tier VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, completed, refunded, failed
  payment_method VARCHAR(50), -- stripe, paypal, etc
  stripe_payment_intent_id VARCHAR(255),
  refund_reason VARCHAR(255),
  refunded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consulting_invoices (
  id BIGSERIAL PRIMARY KEY,
  session_scheduled_id BIGINT REFERENCES consulting_sessions_scheduled(id) ON DELETE CASCADE,
  consulting_payment_id BIGINT REFERENCES consulting_payments(id),
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  customer_email VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  consultant_name VARCHAR(255) NOT NULL,
  amount_cents INT NOT NULL,
  service_tier VARCHAR(50) NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  due_at TIMESTAMP,
  paid_at TIMESTAMP,
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, issued, paid, overdue, cancelled
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Insert default consulting packages
INSERT INTO consulting_packages (service_tier, package_name, description, base_price, duration_hours, includes_deliverables, max_revisions) VALUES
  ('initial', 'Initial Consultation', 'One-time introductory business consultation', 10000, 2, false, 0),
  ('foundation', 'Foundation Package', 'Comprehensive business setup and strategy', 50000, 8, true, 2),
  ('implementation', 'Implementation Package', 'Full implementation with ongoing support', 100000, 20, true, 5),
  ('transformation', 'Transformation Package', 'Complete business transformation and scaling', 250000, 40, true, 10);

-- Indexes for efficient queries
CREATE INDEX idx_consulting_payments_session
ON consulting_payments(session_scheduled_id);

CREATE INDEX idx_consulting_payments_status
ON consulting_payments(status);

CREATE INDEX idx_consulting_invoices_session
ON consulting_invoices(session_scheduled_id);

CREATE INDEX idx_consulting_invoices_email
ON consulting_invoices(customer_email);
