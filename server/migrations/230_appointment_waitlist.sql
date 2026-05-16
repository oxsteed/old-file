-- Migration 192: Appointment waitlist and cancellation notifications
-- Let customers join waitlist when preferred time not available

BEGIN;

CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preferred_date_start DATE,
  preferred_date_end DATE,
  preferred_time_start TIME,
  preferred_time_end TIME,
  staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'accepted', 'expired', 'cancelled')),
  position_in_queue INTEGER,
  offer_made_at TIMESTAMP WITH TIME ZONE,
  offer_expires_at TIMESTAMP WITH TIME ZONE,
  offer_accepted_at TIMESTAMP WITH TIME ZONE,
  resulting_appointment_id UUID REFERENCES business_appointments(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(customer_id, service_id) WHERE status = 'waiting'
);

CREATE INDEX idx_appointment_waitlist_service_id ON appointment_waitlist(service_id);
CREATE INDEX idx_appointment_waitlist_customer_id ON appointment_waitlist(customer_id);
CREATE INDEX idx_appointment_waitlist_status ON appointment_waitlist(status);
CREATE INDEX idx_appointment_waitlist_position_in_queue ON appointment_waitlist(position_in_queue) WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS waitlist_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_id UUID NOT NULL REFERENCES appointment_waitlist(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('slot_available', 'offer_expiring_soon', 'offer_expired', 'position_improved')),
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('sms', 'email', 'both')),
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_waitlist_notifications_waitlist_id ON waitlist_notifications(waitlist_id);
CREATE INDEX idx_waitlist_notifications_notification_type ON waitlist_notifications(notification_type);

COMMIT;
