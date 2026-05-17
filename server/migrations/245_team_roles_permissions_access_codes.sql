-- Migration 245: Team roles, permission catalog, role defaults, overrides,
--                reusable per-business access codes, workspace contexts,
--                conversation assignments, team notes.
--
-- Implements the OxSteed team-role spec on top of the existing
--   business_members (mgr / representative only)
--   business_invite_tokens (single-use)
--   business_audit_log (already created in 232)
-- by:
--   1. Expanding role CHECKs to include 'employee' and 'support_agent'.
--   2. Fixing the broken validate_member_role_update trigger from 187
--      which checked bm.role='owner' but owners are stored in businesses.user_id.
--   3. Introducing a permission catalog + role defaults + per-membership
--      overrides so we resolve effective permissions at request time.
--   4. Adding a reusable per-business access code (Vortex code) flow that
--      complements the existing single-use business_invite_tokens table.
--   5. Tracking which business workspace each user last selected
--      (for the workspace switcher + auto-select on login).
--   6. Conversation queue assignments + scoped team notes.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Expand business_members.role CHECK to include new role codes
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_name TEXT;
BEGIN
  SELECT conname INTO c_name
    FROM pg_constraint
   WHERE conrelid = 'business_members'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%IN%';
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE business_members DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- table not present yet; will be created by 062
  NULL;
END $$;

ALTER TABLE business_members
  ADD CONSTRAINT business_members_role_check
  CHECK (role IN ('manager', 'representative', 'employee', 'support_agent'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Expand business_invite_tokens.role CHECK same way
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_name TEXT;
BEGIN
  SELECT conname INTO c_name
    FROM pg_constraint
   WHERE conrelid = 'business_invite_tokens'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%role%IN%';
  IF c_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE business_invite_tokens DROP CONSTRAINT ' || quote_ident(c_name);
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

ALTER TABLE business_invite_tokens
  ADD CONSTRAINT business_invite_tokens_role_check
  CHECK (role IN ('manager', 'representative', 'employee', 'support_agent'));

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Repair validate_member_role_update trigger from migration 187.
--    Original checked `bm.role = 'owner'` inside business_members, but
--    owners are never stored there (they live in businesses.user_id),
--    so the trigger blocked every legitimate role change.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_member_role_update()
RETURNS TRIGGER AS $$
DECLARE
  owner_uid UUID;
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    -- Look up the actual business owner from the businesses table
    SELECT user_id INTO owner_uid
      FROM businesses
     WHERE id = NEW.business_id;

    IF owner_uid IS NULL THEN
      RAISE EXCEPTION 'Business % not found while validating role change', NEW.business_id;
    END IF;

    IF NEW.role_updated_by IS DISTINCT FROM owner_uid THEN
      RAISE EXCEPTION 'Only the business owner can modify member roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Roles catalog
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_roles (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(40) NOT NULL UNIQUE,
  name          VARCHAR(80) NOT NULL,
  description   TEXT,
  is_system     BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO team_roles (code, name, description, sort_order) VALUES
  ('owner',          'Owner',          'Full control of the business workspace.',         10),
  ('manager',        'Manager',        'Day-to-day operations without true ownership.',    20),
  ('representative', 'Representative', 'Handles leads, follow-ups, and sales conversion.', 30),
  ('employee',       'Employee',       'Handles assigned work only.',                       40),
  ('support_agent',  'Support Agent',  'Handles support chat, ticketing, and triage.',     50)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Permission catalog
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_permissions (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(80) NOT NULL UNIQUE,
  group_key    VARCHAR(40) NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_permissions_group
  ON team_permissions (group_key);

INSERT INTO team_permissions (code, group_key, description) VALUES
  -- business
  ('business.view',              'business', 'View business workspace.'),
  ('business.edit_profile',      'business', 'Edit business profile basics.'),
  ('business.edit_branding',     'business', 'Edit business branding.'),
  ('business.manage_locations',  'business', 'Manage business locations.'),
  ('business.manage_hours',      'business', 'Manage business hours.'),
  -- team
  ('team.view',                  'team',     'View team roster.'),
  ('team.invite',                'team',     'Invite new team members.'),
  ('team.edit_member',           'team',     'Edit existing team members.'),
  ('team.remove_member',         'team',     'Remove team members.'),
  ('team.assign_roles',          'team',     'Assign roles to team members.'),
  ('team.assign_permissions',    'team',     'Assign permission overrides.'),
  -- jobs
  ('jobs.view_all',              'jobs',     'View all business jobs.'),
  ('jobs.view_assigned',         'jobs',     'View only jobs assigned to self.'),
  ('jobs.create',                'jobs',     'Create new jobs.'),
  ('jobs.edit',                  'jobs',     'Edit jobs.'),
  ('jobs.assign',                'jobs',     'Assign jobs to team members.'),
  ('jobs.reassign',              'jobs',     'Reassign jobs.'),
  ('jobs.change_status',         'jobs',     'Update job status.'),
  ('jobs.cancel',                'jobs',     'Cancel jobs.'),
  ('jobs.close',                 'jobs',     'Close completed jobs.'),
  -- calendar
  ('calendar.view_all',          'calendar', 'View all calendars.'),
  ('calendar.view_self',         'calendar', 'View own calendar.'),
  ('calendar.manage_all',        'calendar', 'Manage all calendars.'),
  ('calendar.manage_self',       'calendar', 'Manage own availability.'),
  -- messages
  ('messages.view_all',          'messages', 'View all conversations.'),
  ('messages.view_assigned',     'messages', 'View only assigned conversations.'),
  ('messages.reply',             'messages', 'Reply to conversations.'),
  ('messages.assign_threads',    'messages', 'Assign / reassign conversation threads.'),
  ('messages.use_ai',            'messages', 'Use AI assist tools.'),
  ('messages.view_internal_notes','messages','View internal notes on threads.'),
  -- customers
  ('customers.view_all',         'customers','View all customers.'),
  ('customers.view_assigned',    'customers','View only assigned customers.'),
  ('customers.edit_notes',       'customers','Edit customer notes.'),
  ('customers.export',           'customers','Export customer data.'),
  -- sales
  ('leads.view',                 'sales',    'View leads.'),
  ('leads.create',               'sales',    'Create new leads.'),
  ('leads.edit',                 'sales',    'Edit leads.'),
  ('quotes.create',              'sales',    'Create quotes.'),
  ('quotes.edit',                'sales',    'Edit quotes.'),
  ('quotes.send',                'sales',    'Send quotes to customers.'),
  ('quotes.approve_discounts',   'sales',    'Approve discounts on quotes.'),
  ('representative.manage_pipeline','sales', 'Manage sales pipeline.'),
  -- finance
  ('invoices.view',              'finance',  'View invoices.'),
  ('invoices.create',            'finance',  'Create invoices.'),
  ('payments.view',              'finance',  'View payments.'),
  ('refunds.request',            'finance',  'Request refunds.'),
  ('refunds.approve',            'finance',  'Approve refunds.'),
  ('payouts.view',               'finance',  'View payouts.'),
  ('payouts.manage',             'finance',  'Manage payouts.'),
  ('payroll.view',               'finance',  'View payroll.'),
  -- catalog
  ('templates.view',             'catalog',  'View templates.'),
  ('templates.apply',            'catalog',  'Apply templates.'),
  ('products.view',              'catalog',  'View products.'),
  ('products.manage',            'catalog',  'Manage products.'),
  ('tools.manage',               'catalog',  'Manage tools / equipment.'),
  -- analytics
  ('analytics.view_summary',     'analytics','View summary analytics.'),
  ('analytics.view_ops',         'analytics','View operations analytics.'),
  ('analytics.view_financial',   'analytics','View financial analytics.'),
  -- support
  ('support.view_queue',         'support',  'View support queue.'),
  ('support.resolve',            'support',  'Resolve support tickets.'),
  ('support.escalate',           'support',  'Escalate support tickets.'),
  ('support.manage_macros',      'support',  'Manage saved replies / macros.'),
  ('support.manage_help_center', 'support',  'Manage help center / KB.'),
  -- compliance
  ('documents.view',             'compliance','View documents.'),
  ('documents.manage',           'compliance','Manage documents.'),
  ('agreements.view',            'compliance','View signed agreements.'),
  ('audit.view',                 'compliance','View audit log.'),
  -- settings
  ('settings.general',           'settings', 'Manage general settings.'),
  ('settings.integrations',      'settings', 'Manage integrations.'),
  ('settings.notifications',     'settings', 'Manage notification settings.'),
  ('settings.billing',           'settings', 'Manage billing.'),
  ('settings.security',          'settings', 'Manage security settings.'),
  -- ownership-only
  ('owner.transfer',             'owner',    'Transfer ownership.'),
  ('owner.delete_business',      'owner',    'Delete the business.'),
  ('owner.change_legal_entity',  'owner',    'Change legal entity details.')
ON CONFLICT (code) DO UPDATE
  SET group_key = EXCLUDED.group_key,
      description = EXCLUDED.description;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Role -> permission defaults
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_role_permissions (
  role_id        INTEGER NOT NULL REFERENCES team_roles(id)       ON DELETE CASCADE,
  permission_id  INTEGER NOT NULL REFERENCES team_permissions(id) ON DELETE CASCADE,
  allow          BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (role_id, permission_id)
);

-- OWNER: every permission
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r CROSS JOIN team_permissions p
 WHERE r.code = 'owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- MANAGER: everything except owner-only, billing/security, refund-approve,
--          payouts.manage, payroll.view  (per spec section 2.B)
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r CROSS JOIN team_permissions p
 WHERE r.code = 'manager'
   AND p.code NOT IN (
     'owner.transfer','owner.delete_business','owner.change_legal_entity',
     'settings.billing','settings.security',
     'refunds.approve','payouts.manage','payroll.view'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- EMPLOYEE: assigned-only scopes  (spec section 2.C)
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r CROSS JOIN team_permissions p
 WHERE r.code = 'employee'
   AND p.code IN (
     'business.view',
     'jobs.view_assigned','jobs.change_status',
     'calendar.view_self','calendar.manage_self',
     'messages.view_assigned','messages.reply','messages.use_ai',
     'customers.view_assigned',
     'templates.view','templates.apply',
     'products.view'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- REPRESENTATIVE: sales scope  (spec section 2.D)
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r CROSS JOIN team_permissions p
 WHERE r.code = 'representative'
   AND p.code IN (
     'business.view','business.edit_profile',
     'leads.view','leads.create','leads.edit',
     'quotes.create','quotes.edit','quotes.send',
     'representative.manage_pipeline',
     'calendar.view_self','calendar.manage_self',
     'messages.view_assigned','messages.reply','messages.use_ai','messages.view_internal_notes',
     'customers.view_assigned','customers.edit_notes',
     'analytics.view_summary'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- SUPPORT_AGENT: support scope  (spec section 2.E)
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r CROSS JOIN team_permissions p
 WHERE r.code = 'support_agent'
   AND p.code IN (
     'business.view',
     'support.view_queue','support.resolve','support.escalate','support.manage_macros',
     'messages.view_assigned','messages.reply','messages.use_ai','messages.view_internal_notes',
     'customers.view_assigned','customers.edit_notes',
     'calendar.view_self','calendar.manage_self',
     'documents.view',
     'analytics.view_summary'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Per-membership permission overrides (allow / deny)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_permission_overrides (
  id                 BIGSERIAL    PRIMARY KEY,
  membership_id      BIGINT       NOT NULL REFERENCES business_members(id) ON DELETE CASCADE,
  permission_id      INTEGER      NOT NULL REFERENCES team_permissions(id) ON DELETE CASCADE,
  effect             VARCHAR(10)  NOT NULL CHECK (effect IN ('allow','deny')),
  reason             TEXT,
  granted_by_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (membership_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_mpo_membership
  ON membership_permission_overrides (membership_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Reusable per-business access codes (Vortex code-entry path)
--    Distinct from business_invite_tokens (single-use email-token flow).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_access_codes (
  id            BIGSERIAL    PRIMARY KEY,
  business_id   INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code          VARCHAR(32)  NOT NULL UNIQUE,
  role          VARCHAR(30)  NOT NULL DEFAULT 'representative'
                  CHECK (role IN ('manager','representative','employee','support_agent')),
  label         VARCHAR(120),
  max_uses      INTEGER,            -- NULL = unlimited
  uses          INTEGER      NOT NULL DEFAULT 0,
  requires_approval BOOLEAN  NOT NULL DEFAULT TRUE,
  expires_at    TIMESTAMPTZ,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  rotated_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bac_business
  ON business_access_codes (business_id)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bac_code_active
  ON business_access_codes (code)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS business_access_code_redemptions (
  id           BIGSERIAL   PRIMARY KEY,
  code_id      BIGINT      NOT NULL REFERENCES business_access_codes(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id BIGINT     REFERENCES business_members(id) ON DELETE SET NULL,
  ip_address   INET,
  user_agent   TEXT,
  redeemed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bacr_code
  ON business_access_code_redemptions (code_id);
CREATE INDEX IF NOT EXISTS idx_bacr_user
  ON business_access_code_redemptions (user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Per-user "last selected workspace" tracking
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_workspace_contexts (
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id      INTEGER      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  membership_id    BIGINT       REFERENCES business_members(id) ON DELETE SET NULL,
  last_selected_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_uwc_user_last
  ON user_workspace_contexts (user_id, last_selected_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Conversation queue assignments (per-business)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_team_assignments (
  id                 BIGSERIAL   PRIMARY KEY,
  business_id        INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id    UUID        NOT NULL,
  membership_id      BIGINT      REFERENCES business_members(id) ON DELETE SET NULL,
  queue_type         VARCHAR(30) NOT NULL DEFAULT 'general'
                       CHECK (queue_type IN ('general','sales','support','operations')),
  assigned_by_user_id UUID       REFERENCES users(id) ON DELETE SET NULL,
  assigned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cta_business_active
  ON conversation_team_assignments (business_id, queue_type, assigned_at DESC)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cta_conversation
  ON conversation_team_assignments (conversation_id);

CREATE INDEX IF NOT EXISTS idx_cta_membership
  ON conversation_team_assignments (membership_id)
  WHERE released_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Scoped team notes
--     visibility_scope:
--       owner_only    – visible to business owner only
--       managers      – visible to owner + managers
--       team          – visible to all active members
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_notes (
  id                       BIGSERIAL   PRIMARY KEY,
  business_id              INTEGER     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
  job_id                   UUID,
  created_by_membership_id BIGINT      REFERENCES business_members(id) ON DELETE SET NULL,
  created_by_user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  visibility_scope         VARCHAR(20) NOT NULL DEFAULT 'team'
                             CHECK (visibility_scope IN ('owner_only','managers','team')),
  body                     TEXT        NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_notes_business
  ON team_notes (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_notes_customer
  ON team_notes (customer_user_id)
  WHERE customer_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_notes_job
  ON team_notes (job_id)
  WHERE job_id IS NOT NULL;

COMMIT;
