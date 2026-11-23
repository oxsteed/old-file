-- Groups 5-6 items 217/220/283 (assignment history) and 225 (service issues).
CREATE TABLE IF NOT EXISTS business_appointment_assignment_events (
  id BIGSERIAL PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('reassign','claim','release','transfer','handover','absence','offboarding','confirm','decline')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_appt_assign_events_appt ON business_appointment_assignment_events (appointment_id, id);
CREATE INDEX IF NOT EXISTS business_appt_assign_events_biz ON business_appointment_assignment_events (business_id, id DESC);

CREATE TABLE IF NOT EXISTS business_service_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('quality','incomplete','damage','late_or_no_show','conduct','billing','other')),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reporter_id, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_service_issues_one_open ON business_service_issues (appointment_id, reporter_id) WHERE status IN ('open','in_review');
CREATE INDEX IF NOT EXISTS business_service_issues_queue ON business_service_issues (business_id, status, created_at);
