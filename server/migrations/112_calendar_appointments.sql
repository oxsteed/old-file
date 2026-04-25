-- Core appointments table
CREATE TABLE appointments (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  service_description TEXT NOT NULL,
  scheduled_start_time TIMESTAMPTZ NOT NULL,
  scheduled_end_time TIMESTAMPTZ NOT NULL,
  estimated_duration_minutes INT DEFAULT 60,
  location_address TEXT,
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled')),
  notes TEXT,
  customer_notes TEXT,
  helper_notes TEXT,
  cancellation_reason TEXT,
  cancelled_by VARCHAR(20) CHECK (cancelled_by IN ('customer', 'helper', 'admin')),
  cancelled_at TIMESTAMPTZ,
  rescheduled_from_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_appointments_customer_id ON appointments(customer_id);
CREATE INDEX idx_appointments_helper_id ON appointments(helper_id);
CREATE INDEX idx_appointments_job_id ON appointments(job_id);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_scheduled_start_time ON appointments(scheduled_start_time);
CREATE INDEX idx_appointments_customer_status ON appointments(customer_id, status);
CREATE INDEX idx_appointments_helper_status ON appointments(helper_id, status);

-- Availability blocks for helpers
CREATE TABLE availability_blocks (
  id BIGSERIAL PRIMARY KEY,
  helper_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (type IN ('available', 'unavailable', 'busy')),
  recurring_rule VARCHAR(255), -- iCalendar RRULE format
  recurring_until TIMESTAMPTZ,
  title VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_availability_blocks_helper_id ON availability_blocks(helper_id);
CREATE INDEX idx_availability_blocks_start_time ON availability_blocks(start_time);
CREATE INDEX idx_availability_blocks_end_time ON availability_blocks(end_time);
CREATE INDEX idx_availability_blocks_helper_time ON availability_blocks(helper_id, start_time, end_time);

-- Calendar notifications
CREATE TABLE calendar_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  notification_type VARCHAR(30) NOT NULL CHECK (notification_type IN (
    'appointment_requested',
    'appointment_confirmed',
    'appointment_cancelled',
    'appointment_rescheduled',
    'reminder_24h',
    'reminder_2h',
    'reminder_same_day',
    'appointment_completed'
  )),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
  scheduled_send_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_calendar_notifications_user_id ON calendar_notifications(user_id);
CREATE INDEX idx_calendar_notifications_appointment_id ON calendar_notifications(appointment_id);
CREATE INDEX idx_calendar_notifications_status ON calendar_notifications(status);
CREATE INDEX idx_calendar_notifications_scheduled_send_at ON calendar_notifications(scheduled_send_at);
CREATE INDEX idx_calendar_notifications_user_status ON calendar_notifications(user_id, status);

-- Notification preferences per user
CREATE TABLE notification_preferences (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  appointment_confirmed_channels TEXT[] DEFAULT ARRAY['in_app', 'email'],
  appointment_cancelled_channels TEXT[] DEFAULT ARRAY['in_app', 'email'],
  reminder_24h_channels TEXT[] DEFAULT ARRAY['in_app', 'email'],
  reminder_2h_channels TEXT[] DEFAULT ARRAY['in_app'],
  reminder_same_day_channels TEXT[] DEFAULT ARRAY['in_app', 'sms'],
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone VARCHAR(50) DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_notification_preferences_user_id ON notification_preferences(user_id);

-- Audit log for calendar actions
CREATE TABLE calendar_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  ip_hash VARCHAR(64),
  user_agent_hash VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_calendar_audit_log_user_id ON calendar_audit_log(user_id);
CREATE INDEX idx_calendar_audit_log_appointment_id ON calendar_audit_log(appointment_id);
CREATE INDEX idx_calendar_audit_log_created_at ON calendar_audit_log(created_at DESC);
