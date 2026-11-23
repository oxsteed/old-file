-- Groups 5-6 items 252-300: business team member work. Additive, idempotent.
ALTER TABLE business_operating_policies ADD COLUMN IF NOT EXISTS allow_self_claim BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE business_operating_policies ADD COLUMN IF NOT EXISTS dispatch_confirm_hours INTEGER CHECK (dispatch_confirm_hours IS NULL OR dispatch_confirm_hours BETWEEN 1 AND 168);
ALTER TABLE business_operating_policies ADD COLUMN IF NOT EXISTS require_completion_record BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE business_operating_policies ADD COLUMN IF NOT EXISTS escalation_hours INTEGER NOT NULL DEFAULT 4 CHECK (escalation_hours BETWEEN 1 AND 168);

-- 255 / 288
CREATE TABLE IF NOT EXISTS business_permission_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  membership_id BIGINT NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id),
  permission_code TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  context_path TEXT CHECK (context_path IS NULL OR char_length(context_path) <= 200),
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 365),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (decided_by IS NULL OR decided_by <> requester_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_permission_requests_open_uq ON business_permission_requests (membership_id, permission_code) WHERE status='pending';

-- 260
ALTER TABLE business_appointments ADD COLUMN IF NOT EXISTS dispatch_status TEXT CHECK (dispatch_status IS NULL OR dispatch_status IN ('pending','confirmed','declined'));
ALTER TABLE business_appointments ADD COLUMN IF NOT EXISTS dispatch_responded_at TIMESTAMPTZ;
ALTER TABLE business_appointments ADD COLUMN IF NOT EXISTS dispatch_note TEXT;

-- 262
CREATE TABLE IF NOT EXISTS business_service_checklists (
  service_id INTEGER PRIMARY KEY REFERENCES business_services(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS business_appointment_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
  position INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_appointment_checklist_items_appt ON business_appointment_checklist_items (appointment_id, position);

-- 264
CREATE TABLE IF NOT EXISTS business_appointment_progress (
  id BIGSERIAL PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  percent INTEGER CHECK (percent IS NULL OR percent BETWEEN 0 AND 100),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_appointment_progress_appt ON business_appointment_progress (appointment_id, created_at DESC);

-- 265, 286-290
CREATE TABLE IF NOT EXISTS business_work_exceptions (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES business_appointments(id) ON DELETE SET NULL,
  task_id UUID,
  raised_by UUID NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('exception','missing_instruction','incident','access_denied','reassignment_request')),
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high','critical')),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 5 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  routed_to UUID REFERENCES users(id) ON DELETE SET NULL,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  escalated_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution TEXT CHECK (resolution IS NULL OR char_length(resolution) <= 1000),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raised_by, request_id)
);
CREATE INDEX IF NOT EXISTS business_work_exceptions_biz ON business_work_exceptions (business_id, status, created_at DESC);

-- 266-270
CREATE TABLE IF NOT EXISTS business_crews (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  lead_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_crews_name_uq ON business_crews (business_id, LOWER(name)) WHERE is_active;
CREATE TABLE IF NOT EXISTS business_crew_members (
  crew_id BIGINT NOT NULL REFERENCES business_crews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (crew_id, user_id)
);
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'staff' CHECK (member_type IN ('staff','subcontractor'));
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS company_name TEXT;
CREATE TABLE IF NOT EXISTS business_appointment_crew (
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member')),
  task_note TEXT CHECK (task_note IS NULL OR char_length(task_note) <= 300),
  allocated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attendance TEXT NOT NULL DEFAULT 'pending' CHECK (attendance IN ('pending','confirmed','declined','checked_in')),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (appointment_id, user_id)
);
CREATE INDEX IF NOT EXISTS business_appointment_crew_user ON business_appointment_crew (user_id);
CREATE TABLE IF NOT EXISTS business_appointment_documents (
  id BIGSERIAL PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 5000),
  url TEXT CHECK (url IS NULL OR url ~ '^https://'),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 274-275
CREATE TABLE IF NOT EXISTS business_note_mentions (
  note_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES business_appointments(id) ON DELETE CASCADE,
  mentioned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX IF NOT EXISTS business_note_mentions_user ON business_note_mentions (user_id, business_id) WHERE read_at IS NULL;
CREATE TABLE IF NOT EXISTS business_work_inbox_state (
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, user_id)
);

-- 277
CREATE TABLE IF NOT EXISTS business_shift_coverage_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  shift_id BIGINT NOT NULL,
  requester_id UUID NOT NULL REFERENCES users(id),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','approved','declined','cancelled')),
  claimed_by UUID REFERENCES users(id),
  claimed_at TIMESTAMPTZ,
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (claimed_by IS NULL OR claimed_by <> requester_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_shift_coverage_open_uq ON business_shift_coverage_requests (shift_id) WHERE status IN ('open','claimed');

-- 281-285
CREATE TABLE IF NOT EXISTS business_appointment_completions (
  appointment_id UUID PRIMARY KEY REFERENCES business_appointments(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 5 AND 2000),
  follow_up_needed BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_note TEXT CHECK (follow_up_note IS NULL OR char_length(follow_up_note) <= 1000),
  customer_signoff_name TEXT CHECK (customer_signoff_name IS NULL OR char_length(customer_signoff_name) <= 120),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS business_appointment_materials (
  id BIGSERIAL PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES business_appointments(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit TEXT CHECK (unit IS NULL OR char_length(unit) <= 20),
  cost_cents BIGINT CHECK (cost_cents IS NULL OR cost_cents >= 0),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_appointment_materials_appt ON business_appointment_materials (appointment_id);
CREATE TABLE IF NOT EXISTS business_handoff_acknowledgments (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES business_appointments(id) ON DELETE CASCADE,
  handover_id BIGINT,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS business_handoff_ack_uq ON business_handoff_acknowledgments (user_id, COALESCE(appointment_id::text,''), COALESCE(handover_id,0));
CREATE TABLE IF NOT EXISTS business_feedback_followups (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL UNIQUE REFERENCES business_appointments(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  staff_id UUID REFERENCES users(id) ON DELETE SET NULL,
  routed_to UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','contacted','resolved')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 291-295
CREATE TABLE IF NOT EXISTS business_shift_handovers (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id UUID REFERENCES users(id),
  shift_id BIGINT,
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 5 AND 2000),
  open_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_shift_handovers_to ON business_shift_handovers (business_id, to_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS business_team_task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS business_absence_delegations (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  delegate_id UUID NOT NULL REFERENCES users(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined','cancelled')),
  responded_at TIMESTAMPTZ,
  moved_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK (user_id <> delegate_id)
);
CREATE TABLE IF NOT EXISTS business_shift_reviews (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  review_date DATE NOT NULL,
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  unresolved JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id, review_date)
);
