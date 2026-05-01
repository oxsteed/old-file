
-- >>> BEGIN: 106_consulting_session_followups.sql <<<
-- Track post-session follow-up emails and feedback
CREATE TABLE consulting_session_followups (
  id BIGSERIAL PRIMARY KEY,
  session_scheduled_id BIGINT NOT NULL REFERENCES consulting_sessions_scheduled(id) ON DELETE CASCADE,
  followup_type VARCHAR(50) NOT NULL CHECK (followup_type IN ('post_session', 'reminder', 'no_show', 'custom')),
  feedback_rating INT CHECK (feedback_rating >= 1 AND feedback_rating <= 5),
  feedback_text TEXT,
  sent_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consulting_session_followups_session ON consulting_session_followups(session_scheduled_id);
CREATE INDEX idx_consulting_session_followups_type ON consulting_session_followups(followup_type);
CREATE INDEX idx_consulting_session_followups_sent_at ON consulting_session_followups(sent_at DESC);

-- >>> END: 106_consulting_session_followups.sql <<<

-- >>> BEGIN: 107_consultant_availability.sql <<<
-- Migration 107: Consultant availability and scheduling system
-- Note: replaces and supersedes the legacy `consultant_availability` table created in 103.
-- The 103 version was tied to consultants.id (BIGINT); this version is tied directly to users.id (UUID).

DROP TABLE IF EXISTS consultant_availability CASCADE;

-- Table to store consultant availability time slots
CREATE TABLE consultant_availability (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday..6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time),
  UNIQUE (consultant_id, day_of_week)
);

-- Table to store blocked dates (holidays, days off)
CREATE TABLE IF NOT EXISTS consultant_blocked_dates (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (consultant_id, blocked_date)
);

-- Table to store time slot preferences (for specific dates with custom hours)
CREATE TABLE IF NOT EXISTS consultant_schedule_exceptions (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  start_time TIME,       -- NULL means blocked all day
  end_time TIME,         -- NULL means blocked all day
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add consultant_assigned_id and missing scheduling columns to consulting_sessions_scheduled.
-- The base table is created in migration 103 with session_id, scheduled_date, scheduled_time, etc.
-- We add a direct consultant FK and a meeting_link alias used by the new scheduling controller.
ALTER TABLE consulting_sessions_scheduled
  ADD COLUMN IF NOT EXISTS consultant_assigned_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meeting_link VARCHAR(512),
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_consultant_availability_consultant_id
  ON consultant_availability(consultant_id, day_of_week, is_active);

CREATE INDEX IF NOT EXISTS idx_consultant_blocked_dates_consultant_id
  ON consultant_blocked_dates(consultant_id, blocked_date);

CREATE INDEX IF NOT EXISTS idx_consultant_schedule_exceptions_consultant_id
  ON consultant_schedule_exceptions(consultant_id, exception_date);

CREATE INDEX IF NOT EXISTS idx_consulting_sessions_scheduled_consultant_date
  ON consulting_sessions_scheduled(consultant_assigned_id, scheduled_date);

-- Function: get consultant available slots for a given date.
CREATE OR REPLACE FUNCTION get_consultant_available_slots(
  p_consultant_id UUID,
  p_target_date DATE,
  p_slot_duration_minutes INT DEFAULT 60
)
RETURNS TABLE (
  slot_start TIME,
  slot_end TIME,
  is_available BOOLEAN
) AS $$
DECLARE
  v_day_of_week INT;
  v_start_time TIME;
  v_end_time TIME;
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_target_date)::INT;

  -- Schedule exception takes priority
  SELECT cse.start_time, cse.end_time
  INTO v_start_time, v_end_time
  FROM consultant_schedule_exceptions cse
  WHERE cse.consultant_id = p_consultant_id
    AND cse.exception_date = p_target_date
  LIMIT 1;

  IF FOUND THEN
    IF v_start_time IS NULL THEN
      RETURN;
    END IF;
    RETURN QUERY
    SELECT s::TIME,
           (s + (p_slot_duration_minutes || ' minutes')::INTERVAL)::TIME,
           TRUE
    FROM generate_series(
      v_start_time,
      v_end_time - (p_slot_duration_minutes || ' minutes')::INTERVAL,
      (p_slot_duration_minutes || ' minutes')::INTERVAL
    ) AS s;
    RETURN;
  END IF;

  -- Fully blocked date
  IF EXISTS (
    SELECT 1 FROM consultant_blocked_dates
    WHERE consultant_id = p_consultant_id AND blocked_date = p_target_date
  ) THEN
    RETURN;
  END IF;

  -- Recurring availability for this day of week
  SELECT ca.start_time, ca.end_time
  INTO v_start_time, v_end_time
  FROM consultant_availability ca
  WHERE ca.consultant_id = p_consultant_id
    AND ca.day_of_week = v_day_of_week
    AND ca.is_active = TRUE
  LIMIT 1;

  IF v_start_time IS NOT NULL THEN
    RETURN QUERY
    SELECT s::TIME,
           (s + (p_slot_duration_minutes || ' minutes')::INTERVAL)::TIME,
           TRUE
    FROM generate_series(
      v_start_time,
      v_end_time - (p_slot_duration_minutes || ' minutes')::INTERVAL,
      (p_slot_duration_minutes || ' minutes')::INTERVAL
    ) AS s;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function: check if a specific time slot is available (not booked).
CREATE OR REPLACE FUNCTION is_time_slot_available(
  p_consultant_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM consulting_sessions_scheduled
    WHERE consultant_assigned_id = p_consultant_id
      AND scheduled_date = p_date
      AND scheduled_time < p_end_time
      AND (scheduled_time + (duration_minutes || ' minutes')::INTERVAL)::TIME > p_start_time
      AND status IN ('confirmed', 'completed')
  );
END;
$$ LANGUAGE plpgsql;

-- >>> END: 107_consultant_availability.sql <<<

-- >>> BEGIN: 108_consulting_analytics.sql <<<
-- Migration 108: Consulting analytics and performance tracking

-- View: Consultant performance metrics
CREATE OR REPLACE VIEW consultant_performance AS
SELECT
  u.id as consultant_id,
  u.first_name,
  u.last_name,
  COUNT(DISTINCT css.id) as total_sessions,
  COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) as completed_sessions,
  COUNT(DISTINCT CASE WHEN css.status = 'no_show' THEN css.id END) as no_show_sessions,
  ROUND(AVG(CASE WHEN csf.feedback_rating IS NOT NULL THEN csf.feedback_rating END)::numeric, 2) as avg_rating,
  COUNT(DISTINCT csf.id) as feedback_count,
  COUNT(DISTINCT CASE WHEN csf.feedback_rating >= 4 THEN csf.id END) as positive_feedback_count,
  MIN(css.created_at) as first_session_date,
  MAX(CASE WHEN css.status = 'completed' THEN css.updated_at END) as last_completed_date,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) /
        NULLIF(COUNT(DISTINCT css.id), 0), 1) as completion_rate
FROM users u
LEFT JOIN consulting_sessions_scheduled css ON u.id = css.consultant_assigned_id
LEFT JOIN consulting_session_followups csf ON css.id = csf.session_scheduled_id
WHERE u.role IN ('helper', 'helper_pro', 'broker')
GROUP BY u.id, u.first_name, u.last_name;

-- View: Service tier analytics
CREATE OR REPLACE VIEW service_tier_analytics AS
SELECT
  cs.service_tier,
  COUNT(DISTINCT css.id) as total_requests,
  COUNT(DISTINCT CASE WHEN css.status = 'scheduled' THEN css.id END) as scheduled_count,
  COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) as completed_count,
  COUNT(DISTINCT CASE WHEN css.status = 'no_show' THEN css.id END) as no_show_count,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN css.id END) /
        NULLIF(COUNT(DISTINCT css.id), 0), 1) as completion_rate,
  ROUND(AVG(CASE WHEN csf.feedback_rating IS NOT NULL THEN csf.feedback_rating END)::numeric, 2) as avg_rating,
  MIN(css.created_at) as earliest_request,
  MAX(CASE WHEN css.status = 'completed' THEN css.updated_at END) as latest_completion
FROM consulting_sessions cs
LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
LEFT JOIN consulting_session_followups csf ON css.id = csf.session_scheduled_id
GROUP BY cs.service_tier;

-- View: Conversion funnel analytics
CREATE OR REPLACE VIEW conversion_funnel AS
SELECT
  DATE_TRUNC('day', cs.created_at)::DATE as date,
  COUNT(DISTINCT cs.id) as intake_forms,
  COUNT(DISTINCT CASE WHEN css.scheduled_date IS NOT NULL THEN cs.id END) as scheduled_sessions,
  COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN cs.id END) as completed_sessions,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.scheduled_date IS NOT NULL THEN cs.id END) /
        NULLIF(COUNT(DISTINCT cs.id), 0), 1) as scheduling_rate,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN css.status = 'completed' THEN cs.id END) /
        NULLIF(COUNT(DISTINCT cs.id), 0), 1) as completion_rate
FROM consulting_sessions cs
LEFT JOIN consulting_sessions_scheduled css ON cs.id = css.session_id
GROUP BY DATE_TRUNC('day', cs.created_at)::DATE
ORDER BY date DESC;

-- View: Feedback trends over time
CREATE OR REPLACE VIEW feedback_trends AS
SELECT
  DATE_TRUNC('week', csf.created_at)::DATE as week_start,
  COUNT(*) as total_feedback,
  AVG(csf.feedback_rating) as avg_rating,
  COUNT(CASE WHEN csf.feedback_rating >= 4 THEN 1 END) as positive_count,
  COUNT(CASE WHEN csf.feedback_rating < 4 THEN 1 END) as negative_count
FROM consulting_session_followups csf
WHERE csf.feedback_rating IS NOT NULL
GROUP BY DATE_TRUNC('week', csf.created_at)::DATE
ORDER BY week_start DESC;

-- Table: Consultant monthly performance snapshots
CREATE TABLE IF NOT EXISTS consultant_monthly_stats (
  id BIGSERIAL PRIMARY KEY,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  sessions_count INT DEFAULT 0,
  completed_count INT DEFAULT 0,
  no_show_count INT DEFAULT 0,
  avg_rating NUMERIC(3, 2),
  feedback_count INT DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(consultant_id, year, month)
);

-- Table: Conversion metrics snapshots
CREATE TABLE IF NOT EXISTS conversion_metrics_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  intake_forms INT DEFAULT 0,
  scheduled_sessions INT DEFAULT 0,
  completed_sessions INT DEFAULT 0,
  scheduling_rate NUMERIC(5, 2),
  completion_rate NUMERIC(5, 2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(snapshot_date)
);

-- Create indexes for analytics queries
CREATE INDEX idx_consultant_performance_avg_rating
ON consulting_session_followups(session_scheduled_id, feedback_rating)
WHERE feedback_rating IS NOT NULL;

CREATE INDEX idx_service_tier_analytics
ON consulting_sessions(service_tier);

CREATE INDEX idx_conversion_funnel_created
ON consulting_sessions(created_at DESC);

CREATE INDEX idx_feedback_trends_week
ON consulting_session_followups ((DATE_TRUNC('week', created_at)::DATE));

-- >>> END: 108_consulting_analytics.sql <<<

-- >>> BEGIN: 109_consulting_payments.sql <<<
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

-- >>> END: 109_consulting_payments.sql <<<

-- >>> BEGIN: 110_add_initial_to_business_launch.sql <<<
-- Add support for 'initial' package in Business Launch Program
-- Allows $100 initial consultation option alongside Foundation/Launch/Accelerator

ALTER TABLE consulting_requests
  DROP CONSTRAINT IF EXISTS consulting_requests_package_selected_check,
  ADD CONSTRAINT consulting_requests_package_selected_check
    CHECK (package_selected IN ('initial', 'foundation', 'launch', 'accelerator'));

-- Update the column comment for clarity
COMMENT ON COLUMN consulting_requests.package_selected IS 'Package tier: initial ($100/2hr), foundation ($750), launch ($1500), accelerator ($3000)';

-- >>> END: 110_add_initial_to_business_launch.sql <<<

-- >>> BEGIN: 111_add_worldwide_locations.sql <<<
-- Expand consulting_requests to support worldwide countries and states/provinces
-- Add operating_country field and expand operating_state for longer state/province/city names

ALTER TABLE consulting_requests
  ADD COLUMN operating_country VARCHAR(100),
  ALTER COLUMN operating_state SET DATA TYPE VARCHAR(100);

-- Create index for country lookups
CREATE INDEX idx_consulting_requests_country ON consulting_requests(operating_country);

-- Add comment for clarity
COMMENT ON COLUMN consulting_requests.operating_country IS 'Country where business will operate (e.g., US, CA, AU, etc.)';
COMMENT ON COLUMN consulting_requests.operating_state IS 'State, province, region, or city name (flexible for worldwide use)';

-- >>> END: 111_add_worldwide_locations.sql <<<
