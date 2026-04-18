-- ── Phase 5: Lead Generation & Service Booking System ──────────────────────
-- This migration creates tables for managing customer service requests (leads)
-- and quote negotiation between businesses and customers.

-- ── 1. business_leads table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_leads (
  id                 BIGSERIAL       PRIMARY KEY,
  business_id        INTEGER         NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id        BIGINT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_ids        INTEGER[]       DEFAULT '{}',  -- IDs of selected services (from business_services)
  description        TEXT,                          -- Customer's detailed request
  budget_min         DECIMAL(10,2),                 -- Customer's budget range (optional)
  budget_max         DECIMAL(10,2),
  status             VARCHAR(20)     NOT NULL DEFAULT 'pending',  -- pending, quoted, accepted, rejected, completed, cancelled
  lead_number        VARCHAR(20),                   -- Human-readable lead ID (LN-001, LN-002, etc.)
  assigned_to_id     BIGINT          REFERENCES users(id) ON DELETE SET NULL,  -- Business member assigned to lead
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  CONSTRAINT status_check CHECK (status IN ('pending', 'quoted', 'accepted', 'rejected', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_business_leads_business_id ON business_leads(business_id);
CREATE INDEX IF NOT EXISTS idx_business_leads_customer_id ON business_leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_business_leads_status ON business_leads(status);
CREATE INDEX IF NOT EXISTS idx_business_leads_assigned_to ON business_leads(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_business_leads_created_at ON business_leads(created_at DESC);

-- ── 2. lead_quotes table ──────────────────────────────────────────────────
-- Businesses submit quotes/proposals in response to leads
CREATE TABLE IF NOT EXISTS lead_quotes (
  id                 BIGSERIAL       PRIMARY KEY,
  lead_id            BIGINT          NOT NULL REFERENCES business_leads(id) ON DELETE CASCADE,
  business_id        INTEGER         NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quote_number       VARCHAR(20),                   -- Human-readable quote ID (QT-001, QT-002, etc.)
  amount             DECIMAL(10,2)   NOT NULL,
  currency           VARCHAR(3)      NOT NULL DEFAULT 'USD',
  description        TEXT,                         -- Quote details / scope of work
  timeline           VARCHAR(100),                 -- e.g., "3-5 business days", "1 week"
  expires_at         TIMESTAMPTZ,                  -- Quote expiration date
  status             VARCHAR(20)     NOT NULL DEFAULT 'pending',  -- pending, accepted, rejected, expired
  accepted_at        TIMESTAMPTZ,
  accepted_by_id     BIGINT          REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT quote_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_lead_quotes_lead_id ON lead_quotes(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_quotes_business_id ON lead_quotes(business_id);
CREATE INDEX IF NOT EXISTS idx_lead_quotes_status ON lead_quotes(status);
CREATE INDEX IF NOT EXISTS idx_lead_quotes_created_at ON lead_quotes(created_at DESC);

-- ── 3. Sequence for lead/quote numbers ────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS business_lead_number_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS lead_quote_number_seq START 5001;

-- ── 4. Notifications table entries for leads (uses existing notifications table) ──
-- Leads create notifications with type='lead_received', type='quote_received', type='lead_accepted'

-- ── 5. Create trigger to auto-generate lead_number ──────────────────────
CREATE OR REPLACE FUNCTION set_lead_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_number IS NULL THEN
    NEW.lead_number := 'LN-' || LPAD(nextval('business_lead_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_lead_number ON business_leads;
CREATE TRIGGER trigger_set_lead_number
BEFORE INSERT ON business_leads
FOR EACH ROW
EXECUTE FUNCTION set_lead_number();

-- ── 6. Create trigger to auto-generate quote_number ──────────────────────
CREATE OR REPLACE FUNCTION set_quote_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quote_number IS NULL THEN
    NEW.quote_number := 'QT-' || LPAD(nextval('lead_quote_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_quote_number ON lead_quotes;
CREATE TRIGGER trigger_set_quote_number
BEFORE INSERT ON lead_quotes
FOR EACH ROW
EXECUTE FUNCTION set_quote_number();
