-- Group 2 (Household delegate, items 51-100): visit preparation,
-- recurring templates, spending approvals, maintenance plans, documents.
--
-- household_visit_preps is one row per booking the household prepares:
-- the checklist (66), supply reminders (67), accessibility needs (68),
-- provider arrival instructions (69), readiness confirmation (70),
-- availability collected from the recipient (63), the disruption record
-- (86-89), and the visit summary (91). Money never appears here.
-- household_templates are recurring appointment templates (64).
-- household_spending_approvals are delegate requests the owner decides
-- (82, D-36): a record only, never a charge.
-- household_tasks are the household maintenance plans (76-78): vehicle,
-- household, and personal care, with due-date triage (79) and a completed
-- history (80). Recurrence creates the next occurrence on completion so
-- the history row is preserved.
-- household_documents are the recipient-owned vault (92): visit summaries
-- (91) and forwarded receipts (93) shared with named delegations.
CREATE TABLE IF NOT EXISTS household_visit_preps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_delegate_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  supplies JSONB NOT NULL DEFAULT '[]'::jsonb,
  accessibility_needs TEXT,
  arrival_instructions TEXT,
  readiness_confirmed_at TIMESTAMPTZ,
  readiness_confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  availability JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  follow_up JSONB,
  disruption JSONB,
  handoff_note TEXT,
  handoff_acknowledged_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  supplies_reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_household_visit_preps_owner
  ON household_visit_preps (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_household_visit_preps_delegate
  ON household_visit_preps (assigned_delegate_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS household_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  service_name VARCHAR(200) NOT NULL,
  frequency VARCHAR(20) NOT NULL DEFAULT 'weekly',
  preferred_day VARCHAR(20),
  preferred_time VARCHAR(10),
  service_location TEXT,
  recipient_name VARCHAR(200),
  recipient_phone VARCHAR(40),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_templates_owner
  ON household_templates (owner_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_templates_frequency_check'
      AND conrelid = 'household_templates'::regclass
  ) THEN
    ALTER TABLE household_templates
      ADD CONSTRAINT household_templates_frequency_check
      CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS household_spending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegation_id UUID REFERENCES household_delegations(id) ON DELETE SET NULL,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES booking_requests(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_spending_owner
  ON household_spending_approvals (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_household_spending_requester
  ON household_spending_approvals (requested_by, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_spending_amount_check'
      AND conrelid = 'household_spending_approvals'::regclass
  ) THEN
    ALTER TABLE household_spending_approvals
      ADD CONSTRAINT household_spending_amount_check
      CHECK (amount_cents > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_spending_status_check'
      AND conrelid = 'household_spending_approvals'::regclass
  ) THEN
    ALTER TABLE household_spending_approvals
      ADD CONSTRAINT household_spending_status_check
      CHECK (status IN ('pending', 'approved', 'denied'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS household_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  kind VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  vehicle_id UUID,
  due_date DATE,
  recurrence_days INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  notes TEXT,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_tasks_owner
  ON household_tasks (owner_id, status, due_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_tasks_kind_check'
      AND conrelid = 'household_tasks'::regclass
  ) THEN
    ALTER TABLE household_tasks
      ADD CONSTRAINT household_tasks_kind_check
      CHECK (kind IN ('vehicle', 'household', 'personal_care'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_tasks_status_check'
      AND conrelid = 'household_tasks'::regclass
  ) THEN
    ALTER TABLE household_tasks
      ADD CONSTRAINT household_tasks_status_check
      CHECK (status IN ('open', 'done'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS household_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES booking_requests(id) ON DELETE SET NULL,
  kind VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  shared_with_delegation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  forwarded_from UUID REFERENCES household_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_documents_owner
  ON household_documents (owner_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_documents_kind_check'
      AND conrelid = 'household_documents'::regclass
  ) THEN
    ALTER TABLE household_documents
      ADD CONSTRAINT household_documents_kind_check
      CHECK (kind IN ('visit_summary', 'receipt', 'document'));
  END IF;
END $$;
