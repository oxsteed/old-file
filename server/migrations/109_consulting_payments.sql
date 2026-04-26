-- Migration 109: Consulting payments and pricing
-- Note: consulting_packages and consulting_invoices were originally created in migration 103.
-- This migration EXTENDS the 103 schema to add columns the new consultingPaymentController expects,
-- and creates the new consulting_payments table.

-- Extend consulting_packages with new columns expected by consultingPaymentController.
-- The original 103 schema has: tier, name, price_cents, includes_features.
-- The new code expects:        service_tier, package_name, base_price, includes_deliverables, max_revisions.
ALTER TABLE consulting_packages
  ADD COLUMN IF NOT EXISTS service_tier VARCHAR(50),
  ADD COLUMN IF NOT EXISTS package_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS base_price INT,
  ADD COLUMN IF NOT EXISTS includes_deliverables BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_revisions INT DEFAULT 0;

-- Backfill new columns from old columns where empty
UPDATE consulting_packages
SET service_tier = COALESCE(service_tier, tier),
    package_name = COALESCE(package_name, name),
    base_price   = COALESCE(base_price, price_cents)
WHERE service_tier IS NULL OR package_name IS NULL OR base_price IS NULL;

-- consulting_payments is genuinely new — wasn't in 103.
CREATE TABLE IF NOT EXISTS consulting_payments (
  id BIGSERIAL PRIMARY KEY,
  session_scheduled_id BIGINT REFERENCES consulting_sessions_scheduled(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL,
  service_tier VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'refunded', 'failed')),
  payment_method VARCHAR(50),
  stripe_payment_intent_id VARCHAR(255) UNIQUE,
  refund_reason VARCHAR(255),
  refunded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Extend consulting_invoices to link to consulting_payments (was tied only to purchases in 103).
ALTER TABLE consulting_invoices
  ADD COLUMN IF NOT EXISTS consulting_payment_id BIGINT REFERENCES consulting_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_scheduled_id BIGINT REFERENCES consulting_sessions_scheduled(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS consultant_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS service_tier VARCHAR(50);

-- Seed default consulting packages (idempotent on tier).
-- Use the original 103 column names for the canonical fields, plus new columns.
INSERT INTO consulting_packages (
  tier, name, description, price_cents, duration_hours,
  service_tier, package_name, base_price, includes_deliverables, max_revisions
) VALUES
  ('initial',        'Initial Consultation',     'One-time introductory business consultation',     10000,  2, 'initial',        'Initial Consultation',     10000,  FALSE, 0),
  ('foundation',     'Foundation Package',       'Comprehensive business setup and strategy',       50000,  8, 'foundation',     'Foundation Package',       50000,  TRUE,  2),
  ('implementation', 'Implementation Package',   'Full implementation with ongoing support',       100000, 20, 'implementation', 'Implementation Package',   100000, TRUE,  5),
  ('transformation', 'Transformation Package',   'Complete business transformation and scaling',   250000, 40, 'transformation', 'Transformation Package',   250000, TRUE,  10)
ON CONFLICT (tier) DO UPDATE
  SET service_tier = EXCLUDED.service_tier,
      package_name = EXCLUDED.package_name,
      base_price = EXCLUDED.base_price,
      includes_deliverables = EXCLUDED.includes_deliverables,
      max_revisions = EXCLUDED.max_revisions;

CREATE INDEX IF NOT EXISTS idx_consulting_payments_session
  ON consulting_payments(session_scheduled_id);

CREATE INDEX IF NOT EXISTS idx_consulting_payments_status
  ON consulting_payments(status);

CREATE INDEX IF NOT EXISTS idx_consulting_payments_intent
  ON consulting_payments(stripe_payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_consulting_invoices_payment
  ON consulting_invoices(consulting_payment_id);

CREATE INDEX IF NOT EXISTS idx_consulting_invoices_session
  ON consulting_invoices(session_scheduled_id);

CREATE INDEX IF NOT EXISTS idx_consulting_invoices_email
  ON consulting_invoices(customer_email);
