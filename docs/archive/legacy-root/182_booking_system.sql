-- Migration 182: Booking/Appointment System
-- Customer self-serve appointment booking with availability management
-- Created: 2026-05-15

BEGIN;

-- Service definitions (part of business_services, added here for context)
-- Assumed to already exist from services tab
-- Fields: id, business_id, name, description, duration_minutes, price_cents, category

-- Availability Slots (pre-defined time slots for services)
CREATE TABLE IF NOT EXISTS booking_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  slot_start TIME NOT NULL,
  slot_end TIME NOT NULL,
  staff_id UUID REFERENCES users(id),
  staff_name VARCHAR(255),
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(service_id, slot_date, slot_start, slot_end)
);

CREATE INDEX IF NOT EXISTS idx_booking_slots_service ON booking_slots(service_id);
CREATE INDEX IF NOT EXISTS idx_booking_slots_date ON booking_slots(slot_date);
CREATE INDEX IF NOT EXISTS idx_booking_slots_staff ON booking_slots(staff_id);
CREATE INDEX IF NOT EXISTS idx_booking_slots_available ON booking_slots(is_available);

-- Bookings/Appointments
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id),
  slot_id UUID REFERENCES booking_slots(id),
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  slot_start TIMESTAMP,
  slot_end TIMESTAMP,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending_confirmation' CHECK (status IN (
    'pending_confirmation', 'confirmed', 'in_progress',
    'completed', 'cancelled', 'no_show'
  )),
  cancellation_reason TEXT,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_business ON bookings(business_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service ON bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(slot_start);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC);

-- Booking Confirmations (confirmation workflow tracking)
CREATE TABLE IF NOT EXISTS booking_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  confirmation_token VARCHAR(255) UNIQUE,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired')),
  expires_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(booking_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_confirmations_booking ON booking_confirmations(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_confirmations_token ON booking_confirmations(confirmation_token);

-- Booking Reminders (automated reminder scheduling)
CREATE TABLE IF NOT EXISTS booking_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_type VARCHAR(50) NOT NULL CHECK (reminder_type IN (
    'confirmation_required', 'reminder_24h', 'reminder_1h', 'reminder_same_day'
  )),
  scheduled_at TIMESTAMP NOT NULL,
  sent_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(booking_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_booking_reminders_booking ON booking_reminders(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_reminders_scheduled ON booking_reminders(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_booking_reminders_status ON booking_reminders(status);

-- Booking History/Audit Trail
CREATE TABLE IF NOT EXISTS booking_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  changed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_history_booking ON booking_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_history_action ON booking_history(action);

COMMIT;
