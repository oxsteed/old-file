-- Core appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  helper_id BIGINT NOT NULL,
  job_id BIGINT,
  service_description TEXT NOT NULL,
  scheduled_start_time TIMESTAMPTZ NOT NULL,
  scheduled_end_time TIMESTAMPTZ NOT NULL,
  estimated_duration_minutes INT DEFAULT 60,
  location_address VARCHAR(500),
  location_lat DECIMAL(10, 8) CHECK (location_lat IS NULL OR (location_lat >= -90 AND location_lat <= 90)),
  location_lng DECIMAL(11, 8) CHECK (location_lng IS NULL OR (location_lng >= -180 AND location_lng <= 180)),
  status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  notes TEXT,
  customer_notes TEXT,
  helper_notes TEXT,
  cancellation_reason TEXT,
  cancelled_by VARCHAR(20) CHECK (cancelled_by IN ('customer', 'helper', 'admin')),
  cancelled_at TIMESTAMPTZ,
  rescheduled_from_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_by_user_id BIGINT NOT NULL
);

-- Availability blocks for helpers
CREATE TABLE IF NOT EXISTS availability_blocks (
  id BIGSERIAL PRIMARY KEY,
  helper_id BIGINT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (type IN ('available', 'unavailable', 'busy')),
  recurring_rule VARCHAR(255),
  recurring_until TIMESTAMPTZ,
  title VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Calendar notifications
CREATE TABLE IF NOT EXISTS calendar_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  appointment_id BIGINT NOT NULL,
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

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS notification_preferences (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
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

-- Audit log for calendar actions
CREATE TABLE IF NOT EXISTS calendar_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  appointment_id BIGINT,
  action VARCHAR(50) NOT NULL,
  details JSONB,
  ip_hash VARCHAR(64),
  user_agent_hash VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Add foreign key constraints (idempotent via exception handling)
BEGIN;
ALTER TABLE appointments ADD CONSTRAINT appointments_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE appointments ADD CONSTRAINT appointments_helper_id_fkey
  FOREIGN KEY (helper_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE appointments ADD CONSTRAINT appointments_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE appointments ADD CONSTRAINT appointments_rescheduled_from_id_fkey
  FOREIGN KEY (rescheduled_from_id) REFERENCES appointments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE appointments ADD CONSTRAINT appointments_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE availability_blocks ADD CONSTRAINT availability_blocks_helper_id_fkey
  FOREIGN KEY (helper_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE calendar_notifications ADD CONSTRAINT calendar_notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE calendar_notifications ADD CONSTRAINT calendar_notifications_appointment_id_fkey
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE calendar_audit_log ADD CONSTRAINT calendar_audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

BEGIN;
ALTER TABLE calendar_audit_log ADD CONSTRAINT calendar_audit_log_appointment_id_fkey
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
/

-- Create indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_appointments_customer_id ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_helper_id ON appointments(helper_id);
CREATE INDEX IF NOT EXISTS idx_appointments_job_id ON appointments(job_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_start_time ON appointments(scheduled_start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_customer_status ON appointments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_helper_status ON appointments(helper_id, status);

CREATE INDEX IF NOT EXISTS idx_availability_blocks_helper_id ON availability_blocks(helper_id);
CREATE INDEX IF NOT EXISTS idx_availability_blocks_start_time ON availability_blocks(start_time);
CREATE INDEX IF NOT EXISTS idx_availability_blocks_end_time ON availability_blocks(end_time);
CREATE INDEX IF NOT EXISTS idx_availability_blocks_helper_time ON availability_blocks(helper_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_calendar_notifications_user_id ON calendar_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_notifications_appointment_id ON calendar_notifications(appointment_id);
CREATE INDEX IF NOT EXISTS idx_calendar_notifications_status ON calendar_notifications(status);
CREATE INDEX IF NOT EXISTS idx_calendar_notifications_scheduled_send_at ON calendar_notifications(scheduled_send_at);
CREATE INDEX IF NOT EXISTS idx_calendar_notifications_user_status ON calendar_notifications(user_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_audit_log_user_id ON calendar_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_audit_log_appointment_id ON calendar_audit_log(appointment_id);
CREATE INDEX IF NOT EXISTS idx_calendar_audit_log_created_at ON calendar_audit_log(created_at DESC);
