-- Migration 215: Per-business client (customer) book
--
-- The Business Hub gets a "Clients" tab so an owner / manager can keep their
-- customer relationships organised per business. A customer who hires "Quick
-- Fixes Plumbing" and "Elite Home Repairs" shows up in each business's client
-- list independently.
--
-- Schema: a lightweight CRM table keyed to business_id.
--
--   * Optional FK to users(id) when the customer has an OxSteed account
--   * Free-text name / email / phone / address so off-platform customers fit
--   * Tag list, internal notes, lifetime metrics
--   * Soft delete

CREATE TABLE IF NOT EXISTS business_clients (
  id              BIGSERIAL    PRIMARY KEY,
  business_id     INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id     UUID         NULL REFERENCES users(id) ON DELETE SET NULL,

  display_name    VARCHAR(160) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(60),
  address_line    VARCHAR(255),
  city            VARCHAR(120),
  state           VARCHAR(120),
  postal_code     VARCHAR(40),
  country         VARCHAR(80),

  -- Workflow / segmentation
  status          VARCHAR(32)  NOT NULL DEFAULT 'active'
    CHECK (status IN ('lead', 'active', 'past', 'archived', 'blocked')),
  tags            TEXT[]       NOT NULL DEFAULT '{}',
  internal_notes  TEXT,
  preferred_contact VARCHAR(20) -- 'email' | 'phone' | 'sms'
    CHECK (preferred_contact IS NULL OR preferred_contact IN ('email', 'phone', 'sms')),

  -- Aggregates (denormalised, recomputed by the controller as needed)
  lifetime_value_cents BIGINT  NOT NULL DEFAULT 0,
  total_jobs           INTEGER NOT NULL DEFAULT 0,
  last_job_at          TIMESTAMPTZ,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_clients_business
  ON business_clients(business_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_clients_customer
  ON business_clients(customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_clients_status
  ON business_clients(business_id, status) WHERE deleted_at IS NULL;

-- Prevent linking the same OxSteed customer twice to the same business
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_clients_unique_customer
  ON business_clients(business_id, customer_id)
  WHERE customer_id IS NOT NULL AND deleted_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_business_clients_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_clients_updated_at ON business_clients;
CREATE TRIGGER trg_business_clients_updated_at
  BEFORE UPDATE ON business_clients
  FOR EACH ROW
  EXECUTE FUNCTION set_business_clients_updated_at();

COMMENT ON TABLE business_clients IS
  'Per-business client list. Each row is a customer the business has worked with (or a lead). customer_id links to users(id) when the customer has an OxSteed account; otherwise display_name + contact fields hold the off-platform record.';
