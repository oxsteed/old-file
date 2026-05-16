-- Migration 188: Appointment notification templates and settings
-- Configure SMS/email reminders, confirmation messages, custom notifications

CREATE TABLE IF NOT EXISTS appointment_notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  notification_type VARCHAR(100) NOT NULL,
  trigger_event VARCHAR(100) NOT NULL CHECK (trigger_event IN (
    'booking_confirmation',
    'reminder_24h',
    'reminder_2h',
    'reminder_same_day',
    'status_changed',
    'cancellation_notice',
    'rescheduled',
    'no_show_warning',
    'feedback_request'
  )),
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('sms', 'email', 'both')),
  is_enabled BOOLEAN DEFAULT TRUE,
  subject VARCHAR(500),
  body TEXT NOT NULL,
  variables_supported TEXT[],
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, notification_type, trigger_event, channel)
);

CREATE INDEX idx_appointment_notification_templates_business_id ON appointment_notification_templates(business_id);
CREATE INDEX idx_appointment_notification_templates_trigger_event ON appointment_notification_templates(trigger_event);
CREATE INDEX idx_appointment_notification_templates_is_enabled ON appointment_notification_templates(is_enabled);

CREATE TABLE IF NOT EXISTS appointment_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  send_confirmation_email BOOLEAN DEFAULT TRUE,
  send_confirmation_sms BOOLEAN DEFAULT FALSE,
  reminder_24h_enabled BOOLEAN DEFAULT TRUE,
  reminder_24h_type VARCHAR(50) CHECK (reminder_24h_type IN ('sms', 'email', 'both')),
  reminder_2h_enabled BOOLEAN DEFAULT FALSE,
  reminder_2h_type VARCHAR(50) CHECK (reminder_2h_type IN ('sms', 'email', 'both')),
  reminder_same_day_enabled BOOLEAN DEFAULT TRUE,
  reminder_same_day_type VARCHAR(50) CHECK (reminder_same_day_type IN ('sms', 'email', 'both')),
  send_rescheduled_notification BOOLEAN DEFAULT TRUE,
  send_cancellation_notification BOOLEAN DEFAULT TRUE,
  send_feedback_request BOOLEAN DEFAULT TRUE,
  feedback_request_days_after_completion INTEGER DEFAULT 2,
  quiet_hours_enabled BOOLEAN DEFAULT FALSE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_appointment_notification_settings_business_id ON appointment_notification_settings(business_id);

CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  notification_type VARCHAR(100) NOT NULL,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('sms', 'email')),
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20),
  subject VARCHAR(500),
  body TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced', 'blocked')),
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_delivery_log_appointment_id ON notification_delivery_log(appointment_id);
CREATE INDEX idx_notification_delivery_log_status ON notification_delivery_log(status);
CREATE INDEX idx_notification_delivery_log_created_at ON notification_delivery_log(created_at DESC);
