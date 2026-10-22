-- Migration 950: Staff training lifecycle (S-12) + compliance document
-- vault and SOP acknowledgements (S-14).
--
-- Additive only. Nothing existing is renamed or repurposed.
--
-- S-12 — training had no retakes, no overdue writer, no versioning, no
-- expiry and no auto-assignment:
--   * restaurant_training_modules gains current_version, valid_for_days
--     (how long a passing completion stays valid before recertification)
--     and max_attempts (quiz attempts per assignment cycle).
--   * restaurant_training_module_versions snapshots module content +
--     questions per version, so a completion can be tied to the exact
--     content the staff member was tested on. Version 1 is backfilled
--     from current content for existing modules.
--   * restaurant_training_completions becomes an attempts log: the
--     UNIQUE(assignment_id) from 667 is dropped, and rows gain
--     module_version, attempt_number and expires_at. The assignment row
--     keeps the lifecycle status; assignments gain attempts_used.
--   * restaurant_training_auto_assign_rules drives automatic assignment
--     by membership role and for new hires (applied immediately when a
--     rule or module changes, and by the nightly sweep for new hires).
--
-- S-14 — compliance documents:
--   * restaurant_staff_documents is the per-employee vault: type, expiry
--     and verification status. Files live in the existing signed-URL
--     storage; only the storage key + metadata are kept here.
--     HARD CONSTRAINT: no SSN or tax-form data is ever stored in OxSteed;
--     I-9/W-4 stay with the business's payroll provider.
--   * restaurant_sop_acknowledgements records read-and-sign of a SOP at a
--     specific version, with the acknowledgement timestamp.

-- ── S-12: module versioning + validity ──────────────────────────────────────
ALTER TABLE restaurant_training_modules
  ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS valid_for_days INTEGER,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_training_modules_max_attempts_check'
  ) THEN
    ALTER TABLE restaurant_training_modules
      ADD CONSTRAINT restaurant_training_modules_max_attempts_check
      CHECK (max_attempts >= 1 AND max_attempts <= 20);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'restaurant_training_modules_valid_for_days_check'
  ) THEN
    ALTER TABLE restaurant_training_modules
      ADD CONSTRAINT restaurant_training_modules_valid_for_days_check
      CHECK (valid_for_days IS NULL OR valid_for_days > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS restaurant_training_module_versions (
  id BIGSERIAL PRIMARY KEY,
  module_id BIGINT NOT NULL REFERENCES restaurant_training_modules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  content TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  pass_score_pct INTEGER NOT NULL DEFAULT 80,
  -- Full question snapshot including correct_index: manager-only data,
  -- never served to staff (same rule as restaurant_training_questions).
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (module_id, version)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_training_versions_module
  ON restaurant_training_module_versions(module_id, version);

-- Backfill version 1 for every existing module from its current content.
INSERT INTO restaurant_training_module_versions
  (module_id, version, title, description, content, category, pass_score_pct, questions, created_by, created_at)
SELECT m.id, 1, m.title, m.description, m.content, m.category, m.pass_score_pct,
       COALESCE((
         SELECT jsonb_agg(
                  jsonb_build_object(
                    'question', q.question,
                    'options', q.options,
                    'correct_index', q.correct_index,
                    'sort_order', q.sort_order
                  ) ORDER BY q.sort_order ASC, q.id ASC)
           FROM restaurant_training_questions q
          WHERE q.module_id = m.id
       ), '[]'::jsonb),
       m.created_by, m.created_at
  FROM restaurant_training_modules m
ON CONFLICT (module_id, version) DO NOTHING;

-- ── S-12: completions become an attempts log ────────────────────────────────
ALTER TABLE restaurant_training_completions
  DROP CONSTRAINT IF EXISTS restaurant_training_completions_assignment_id_key;

ALTER TABLE restaurant_training_completions
  ADD COLUMN IF NOT EXISTS module_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_restaurant_training_completions_assignment
  ON restaurant_training_completions(assignment_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_restaurant_training_completions_expiry
  ON restaurant_training_completions(passed, expires_at)
  WHERE passed = TRUE;

ALTER TABLE restaurant_training_assignments
  ADD COLUMN IF NOT EXISTS attempts_used INTEGER NOT NULL DEFAULT 0;

-- ── S-12: automatic assignment rules ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_training_auto_assign_rules (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  module_id BIGINT NOT NULL REFERENCES restaurant_training_modules(id) ON DELETE CASCADE,
  -- business_members.role to match; NULL means every active member.
  target_role VARCHAR(30),
  -- When TRUE the nightly sweep (and rule application) also assigns this
  -- module to members who join later ("on hire").
  on_hire BOOLEAN NOT NULL DEFAULT TRUE,
  -- Due date offset for auto-created assignments; NULL = no due date.
  due_days INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_training_auto_assign_rule
  ON restaurant_training_auto_assign_rules (module_id, COALESCE(target_role, ''));
CREATE INDEX IF NOT EXISTS idx_training_auto_assign_rules_restaurant
  ON restaurant_training_auto_assign_rules(restaurant_id, is_active);

-- ── S-14: per-employee document vault ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_staff_documents (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  -- The employee the document belongs to.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(40) NOT NULL
    CHECK (doc_type IN (
      'certificate_food_handler', 'certificate_allergen', 'certificate_manager',
      'certificate_other', 'id_document', 'policy_handbook', 'sop_document', 'other'
    )),
  title VARCHAR(200) NOT NULL,
  -- Key into the existing signed-URL storage (utils/storage). The file
  -- itself is never exposed through a public URL.
  storage_key TEXT NOT NULL,
  original_filename VARCHAR(255),
  content_type VARCHAR(120),
  size_bytes BIGINT,
  issued_on DATE,
  expires_on DATE,
  verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Stamp for the manager expiry alert so each document alerts once per
  -- expiry date; reset whenever expires_on changes.
  expiry_alert_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_documents_restaurant_user
  ON restaurant_staff_documents(restaurant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_staff_documents_expiry
  ON restaurant_staff_documents(restaurant_id, expires_on)
  WHERE expires_on IS NOT NULL;

-- ── S-14: SOP read-and-sign acknowledgements ────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_sop_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  sop_id BIGINT NOT NULL REFERENCES restaurant_sops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The SOP version the staff member read and signed.
  sop_version INTEGER NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sop_id, user_id, sop_version)
);

CREATE INDEX IF NOT EXISTS idx_sop_acknowledgements_restaurant
  ON restaurant_sop_acknowledgements(restaurant_id, sop_id);
CREATE INDEX IF NOT EXISTS idx_sop_acknowledgements_user
  ON restaurant_sop_acknowledgements(user_id, sop_id);
