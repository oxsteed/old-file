-- Migration 176: Booking Requests System
-- Enables helper-specific, calendar-based booking requests with fallback to job posting

CREATE TABLE IF NOT EXISTS booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Booking details from customer's request
  service_name VARCHAR(255) NOT NULL,
  requested_date DATE NOT NULL,
  requested_start_time TIME NOT NULL,
  requested_end_time TIME NOT NULL,
  service_location VARCHAR(500),
  description TEXT,

  -- Booking status
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  -- Status values: pending, accepted, declined, expired, cancelled
  -- pending: awaiting helper response
  -- accepted: helper accepted the booking request
  -- declined: helper explicitly declined
  -- expired: 24h timeout with no response
  -- cancelled: customer cancelled before helper response

  -- Timing
  expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
  accepted_at TIMESTAMP,
  declined_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Helper's response (if declined)
  helper_response_reason VARCHAR(500),

  -- Conversion to job posting
  converted_to_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,

  -- Constraints
  CONSTRAINT valid_booking_times CHECK (requested_start_time < requested_end_time),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled'))
);

-- Indexes for common queries
CREATE INDEX idx_booking_requests_customer_id ON booking_requests(customer_id);
CREATE INDEX idx_booking_requests_helper_id ON booking_requests(helper_id);
CREATE INDEX idx_booking_requests_status ON booking_requests(status);
CREATE INDEX idx_booking_requests_expires_at ON booking_requests(expires_at);
CREATE INDEX idx_booking_requests_requested_date ON booking_requests(requested_date);
CREATE INDEX idx_booking_requests_converted_job_id ON booking_requests(converted_to_job_id);

-- Audit logging for booking requests
CREATE TABLE IF NOT EXISTS booking_request_audit_log (
  id BIGSERIAL PRIMARY KEY,
  booking_request_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(32),
  -- actor_type: customer, helper, system (for auto-expiry)
  old_status VARCHAR(32),
  new_status VARCHAR(32),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_booking_request_audit_log_booking_request_id
  ON booking_request_audit_log(booking_request_id);
CREATE INDEX idx_booking_request_audit_log_created_at
  ON booking_request_audit_log(created_at);

-- Helper notification preferences for booking requests (optional)
CREATE TABLE IF NOT EXISTS booking_request_preferences (
  id BIGSERIAL PRIMARY KEY,
  helper_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  auto_accept_enabled BOOLEAN DEFAULT FALSE,
  require_approval_for_new_customers BOOLEAN DEFAULT TRUE,
  min_notice_hours INTEGER DEFAULT 24,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_booking_request_preferences_helper_id
  ON booking_request_preferences(helper_id);
