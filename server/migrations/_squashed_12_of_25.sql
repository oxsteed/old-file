
-- >>> BEGIN: 075b_tool_booking.sql <<<
-- Tool rental bookings
CREATE TABLE tool_rentals_bookings (
  id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  total_price DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT end_after_start CHECK (end_date > start_date)
);

CREATE INDEX idx_bookings_tool_id ON tool_rentals_bookings(tool_id);
CREATE INDEX idx_bookings_customer_id ON tool_rentals_bookings(customer_id);
CREATE INDEX idx_bookings_status ON tool_rentals_bookings(status);

-- >>> END: 075b_tool_booking.sql <<<

-- >>> BEGIN: 076_analytics_events.sql <<<
-- Analytics event tracking
CREATE TABLE tool_rentals_analytics (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tool_id BIGINT REFERENCES tool_rentals(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('view','favorite','inquire','book','review')),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_analytics_user_id ON tool_rentals_analytics(user_id);
CREATE INDEX idx_analytics_tool_id ON tool_rentals_analytics(tool_id);
CREATE INDEX idx_analytics_event_type ON tool_rentals_analytics(event_type);
CREATE INDEX idx_analytics_created_at ON tool_rentals_analytics(created_at);

-- >>> END: 076_analytics_events.sql <<<

-- >>> BEGIN: 076b_business_leads_phase5.sql <<<
-- ── Phase 5: Lead Generation & Service Booking System ──────────────────────
-- This migration creates tables for managing customer service requests (leads)
-- and quote negotiation between businesses and customers.

-- ── 1. business_leads table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_leads (
  id                 BIGSERIAL       PRIMARY KEY,
  business_id        INTEGER         NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id        UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_ids        INTEGER[]       DEFAULT '{}',  -- IDs of selected services (from business_services)
  description        TEXT,                          -- Customer's detailed request
  budget_min         DECIMAL(10,2),                 -- Customer's budget range (optional)
  budget_max         DECIMAL(10,2),
  status             VARCHAR(20)     NOT NULL DEFAULT 'pending',  -- pending, quoted, accepted, rejected, completed, cancelled
  lead_number        VARCHAR(20),                   -- Human-readable lead ID (LN-001, LN-002, etc.)
  assigned_to_id     UUID            REFERENCES users(id) ON DELETE SET NULL,  -- Business member assigned to lead
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
  accepted_by_id     UUID            REFERENCES users(id) ON DELETE SET NULL,
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

-- >>> END: 076b_business_leads_phase5.sql <<<

-- >>> BEGIN: 077_section_visibility.sql <<<
-- Add section visibility toggles to helper_profiles
-- Allows helpers to hide sections they haven't completed or that don't apply to them

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS show_services BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_faqs BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_policies BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_gallery BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_hours BOOLEAN NOT NULL DEFAULT true;

-- Create an index for filtering visible sections
CREATE INDEX IF NOT EXISTS idx_helper_profiles_visible_sections
  ON helper_profiles(user_id)
  WHERE show_services OR show_faqs OR show_policies OR show_gallery OR show_hours;

-- >>> END: 077_section_visibility.sql <<<

-- >>> BEGIN: 077b_contact_history_notifications.sql <<<
-- Owner contact history and notification preferences
CREATE TABLE tool_contact_history (
  id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  inquirer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_contact TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  contact_count INT DEFAULT 1,
  viewed_at TIMESTAMP
);

CREATE UNIQUE INDEX idx_contact_history_unique ON tool_contact_history(tool_id, inquirer_id, owner_id);

-- Notification preferences
CREATE TABLE tool_rental_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notify_new_tools BOOLEAN DEFAULT TRUE,
  notify_bookings BOOLEAN DEFAULT TRUE,
  notify_messages BOOLEAN DEFAULT TRUE,
  notify_price_drop BOOLEAN DEFAULT TRUE,
  saved_filters JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_notification_prefs_user ON tool_rental_notifications(user_id);

-- >>> END: 077b_contact_history_notifications.sql <<<

-- >>> BEGIN: 078_business_reviews.sql <<<
-- ── Phase 6: Business Reviews & Testimonials System ───────────────────────────
-- Enables customers to leave reviews on completed jobs, building social proof
-- and providing feedback to businesses.

-- ── 1. business_reviews table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_reviews (
  id                BIGSERIAL       PRIMARY KEY,
  business_id       INTEGER         NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id       UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id           BIGINT          REFERENCES business_leads(id) ON DELETE SET NULL,  -- Which lead/job this review is for
  rating            SMALLINT        NOT NULL CHECK (rating >= 1 AND rating <= 5),      -- Star rating 1-5
  testimonial       TEXT            NOT NULL,                                         -- Written review (up to 500 chars, validated on client)
  response          TEXT,                                                             -- Optional business response
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_business_reviews_business_id ON business_reviews(business_id);
CREATE INDEX IF NOT EXISTS idx_business_reviews_customer_id ON business_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_business_reviews_lead_id ON business_reviews(lead_id);
CREATE INDEX IF NOT EXISTS idx_business_reviews_rating ON business_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_business_reviews_created_at ON business_reviews(created_at DESC);

-- Partial index: only show published/approved reviews (when moderation is added later)
CREATE INDEX IF NOT EXISTS idx_business_reviews_active ON business_reviews(business_id, created_at DESC);

-- Unique constraint: one review per customer per lead (prevent duplicate reviews)
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_reviews_unique_customer_lead
  ON business_reviews(customer_id, lead_id)
  WHERE lead_id IS NOT NULL;

-- ── 2. Helper function to recalculate review stats (avg rating, count) ──────────
-- Called after a new review is inserted or updated
CREATE OR REPLACE FUNCTION recalculate_business_review_stats(business_id_param INTEGER)
RETURNS TABLE(avg_rating NUMERIC, review_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(AVG(rating)::NUMERIC, 2) as avg_rating,
    COUNT(*)::BIGINT as review_count
  FROM business_reviews
  WHERE business_id = business_id_param;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Trigger to update updated_at on review changes ────────────────────────
CREATE OR REPLACE FUNCTION update_business_review_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_business_review_timestamp ON business_reviews;
CREATE TRIGGER trigger_business_review_timestamp
BEFORE UPDATE ON business_reviews
FOR EACH ROW
EXECUTE FUNCTION update_business_review_timestamp();

-- >>> END: 078_business_reviews.sql <<<
