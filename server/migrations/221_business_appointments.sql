-- Migration 183: Business appointments (service bookings)
-- Tracks customer bookings for business services with payment and status

CREATE TABLE IF NOT EXISTS business_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE RESTRICT,
  staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  customer_notes TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded', 'partial_refund')),
  base_price_cents BIGINT NOT NULL CHECK (base_price_cents >= 0),
  final_price_cents BIGINT NOT NULL CHECK (final_price_cents >= 0),
  stripe_payment_intent_id VARCHAR(500),
  cancellation_reason VARCHAR(500),
  cancelled_by VARCHAR(50) CHECK (cancelled_by IN ('customer', 'business', 'system')),
  cancelled_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  feedback_rating INTEGER CHECK (feedback_rating BETWEEN 1 AND 5),
  feedback_notes TEXT,
  reminder_sent_24h BOOLEAN DEFAULT FALSE,
  reminder_sent_2h BOOLEAN DEFAULT FALSE,
  no_show_marked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_time_range CHECK (start_time < end_time),
  CONSTRAINT final_price_gte_zero CHECK (final_price_cents >= 0)
);

CREATE INDEX idx_business_appointments_business_id ON business_appointments(business_id);
CREATE INDEX idx_business_appointments_service_id ON business_appointments(service_id);
CREATE INDEX idx_business_appointments_staff_id ON business_appointments(staff_id);
CREATE INDEX idx_business_appointments_customer_id ON business_appointments(customer_id);
CREATE INDEX idx_business_appointments_status ON business_appointments(status);
CREATE INDEX idx_business_appointments_start_time ON business_appointments(start_time);
CREATE INDEX idx_business_appointments_time_range ON business_appointments(start_time, end_time);
CREATE INDEX idx_business_appointments_payment_status ON business_appointments(payment_status);

CREATE TABLE IF NOT EXISTS business_appointment_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  created_by_id UUID NOT NULL REFERENCES users(id),
  note_type VARCHAR(50) NOT NULL DEFAULT 'internal' CHECK (note_type IN ('internal', 'customer_visible')),
  content TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_appointment_notes_appointment_id ON business_appointment_notes(appointment_id);
CREATE INDEX idx_business_appointment_notes_created_by_id ON business_appointment_notes(created_by_id);
CREATE INDEX idx_business_appointment_notes_note_type ON business_appointment_notes(note_type);

CREATE TABLE IF NOT EXISTS business_appointment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  reminder_type VARCHAR(50) NOT NULL CHECK (reminder_type IN ('sms', 'email')),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  hours_before INTEGER NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivery_status VARCHAR(50) DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed', 'bounced')),
  failure_reason VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_appointment_reminders_appointment_id ON business_appointment_reminders(appointment_id);
CREATE INDEX idx_business_appointment_reminders_scheduled_at ON business_appointment_reminders(scheduled_at);
CREATE INDEX idx_business_appointment_reminders_delivery_status ON business_appointment_reminders(delivery_status);

CREATE TABLE IF NOT EXISTS business_appointment_reschedule_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  original_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  original_end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  new_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  new_end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  rescheduled_by_id UUID NOT NULL REFERENCES users(id),
  rescheduled_by_type VARCHAR(50) NOT NULL CHECK (rescheduled_by_type IN ('customer', 'business')),
  reason VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_business_appointment_reschedule_history_appointment_id ON business_appointment_reschedule_history(appointment_id);
CREATE INDEX idx_business_appointment_reschedule_history_created_at ON business_appointment_reschedule_history(created_at DESC);
