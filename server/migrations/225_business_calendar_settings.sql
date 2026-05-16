-- Migration 187: Business calendar settings and holidays
-- Time zone, holidays, working hours, and other business calendar configuration

ALTER TABLE IF EXISTS businesses ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'America/Chicago';
ALTER TABLE IF EXISTS businesses ADD COLUMN IF NOT EXISTS business_hours_json JSONB;

CREATE TABLE IF NOT EXISTS business_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  holiday_name VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  is_working BOOLEAN DEFAULT FALSE,
  custom_hours_json JSONB,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, date)
);

CREATE INDEX idx_business_holidays_business_id ON business_holidays(business_id);
CREATE INDEX idx_business_holidays_date ON business_holidays(date);

-- Recurring service schedules (e.g., classes that repeat weekly)
CREATE TABLE IF NOT EXISTS recurring_service_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES business_services(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  recurrence_pattern VARCHAR(50) NOT NULL CHECK (recurrence_pattern IN ('weekly', 'biweekly', 'monthly', 'daily')),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  repeat_until DATE,
  is_active BOOLEAN DEFAULT TRUE,
  max_attendees INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_time_range CHECK (start_time < end_time)
);

CREATE INDEX idx_recurring_service_schedules_service_id ON recurring_service_schedules(service_id);
CREATE INDEX idx_recurring_service_schedules_staff_id ON recurring_service_schedules(staff_id);
CREATE INDEX idx_recurring_service_schedules_is_active ON recurring_service_schedules(is_active);
