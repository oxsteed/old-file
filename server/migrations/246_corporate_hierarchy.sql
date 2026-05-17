-- Migration 246: OxSteed corporate hierarchy (departments, titles, assignments,
--                permissions, per-assignment overrides, audit log).
--
-- This sits ABOVE the existing super-admin / admin layer:
--   * users.role IN ('admin','super_admin') is still the binary access gate.
--   * admin_permission_grants (049) + admin_regions (119) are untouched.
--   * Corporate titles are LABELING + an optional permission overlay so we can
--     express the corporate org chart (CEO, CTO, VP Eng, Marketing Manager, ...)
--     on top of the binary admin flag.
--
-- A user must already be admin or super_admin to receive a corporate title.
-- Title assignment is country/region scoped so multi-region operations
-- (Director of Operations - LATAM, etc.) work out of the box.
--
-- Hybrid permission model:
--   1. Each department has a default permission set (corporate_department_permissions).
--   2. Each assignment can ALLOW or DENY individual permissions on top
--      (corporate_assignment_permission_overrides).
--
-- Assignment guards (enforced in app layer, not by the DB):
--   * super_admin bypasses every guard.
--   * admin can only assign titles whose seniority_level <= the highest seniority
--     of any active assignment the caller holds (cannot_grant_above_level).
--   * admin cannot assign titles flagged is_csuite=TRUE.
--   * admin cannot create new departments or new titles.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Departments
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_departments (
  id          SERIAL       PRIMARY KEY,
  code        VARCHAR(40)  NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  description TEXT,
  icon        VARCHAR(60),
  color       VARCHAR(20),
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corp_dept_sort
  ON corporate_departments (sort_order, name);

INSERT INTO corporate_departments (code, name, description, icon, color, sort_order) VALUES
  ('executive',    'Executive & Strategy',
   'Overall direction and cross-functional decisions.',
   'crown', '#7c3aed', 10),
  ('technology',   'Technology & Engineering',
   'Platform, AI tools, infrastructure, and security.',
   'cpu', '#2563eb', 20),
  ('operations',   'Operations & Customer Success',
   'Day-to-day execution layer for marketplace activity and helper onboarding.',
   'settings', '#0ea5e9', 30),
  ('marketing',    'Marketing, Sales & Growth',
   'Demand generation, helper acquisition, and brand building.',
   'megaphone', '#f97316', 40),
  ('finance',      'Finance, Legal & Compliance',
   'Critical given focus on CFTC awareness, KYC, and multi-income-stream bookkeeping.',
   'dollar-sign', '#16a34a', 50),
  ('people',       'People & Administrative',
   'Recruitment, culture, and back-office functions.',
   'users', '#db2777', 60),
  ('data',         'Data, Research & Innovation',
   'Data science, business intelligence, user research, and innovation.',
   'bar-chart-2', '#0891b2', 70)
ON CONFLICT (code) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      icon        = EXCLUDED.icon,
      color       = EXCLUDED.color,
      sort_order  = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Titles
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_titles (
  id              SERIAL       PRIMARY KEY,
  department_id   INTEGER      NOT NULL REFERENCES corporate_departments(id) ON DELETE CASCADE,
  code            VARCHAR(80)  NOT NULL UNIQUE,
  name            VARCHAR(180) NOT NULL,
  description     TEXT,
  -- 10 = founder/CEO, 9 = C-suite, 8 = VP/Director, 7 = Sr. Manager,
  -- 6 = Manager / Lead, 5 = Sr. IC / Specialist, 4 = IC, 3 = Junior,
  -- 2 = Coordinator, 1 = Entry
  seniority_level INTEGER      NOT NULL DEFAULT 4 CHECK (seniority_level BETWEEN 1 AND 10),
  is_csuite       BOOLEAN      NOT NULL DEFAULT FALSE,
  is_system       BOOLEAN      NOT NULL DEFAULT TRUE,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corp_titles_dept
  ON corporate_titles (department_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_corp_titles_seniority
  ON corporate_titles (seniority_level DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Executive & Strategy
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
       CROSS JOIN (VALUES
         ('ceo',                        'Chief Executive Officer',                   10, TRUE,  10),
         ('coo',                        'Chief Operating Officer',                    9, TRUE,  20),
         ('cfo',                        'Chief Financial Officer',                    9, TRUE,  30),
         ('cto',                        'Chief Technology Officer',                   9, TRUE,  40),
         ('cmo',                        'Chief Marketing Officer',                    9, TRUE,  50),
         ('cpo',                        'Chief Product Officer',                      9, TRUE,  60),
         ('general_counsel',            'General Counsel / Legal Counsel',            9, TRUE,  70),
         ('vp_strategy_bizdev',         'VP of Strategy & Business Development',      8, FALSE, 80),
         ('vp_operations',              'VP of Operations',                           8, FALSE, 90),
         ('ea_to_ceo',                  'Executive Assistant to the CEO',             4, FALSE, 100)
       ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'executive'
ON CONFLICT (code) DO UPDATE
  SET department_id   = EXCLUDED.department_id,
      name            = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite       = EXCLUDED.is_csuite,
      sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- Technology & Engineering
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
       CROSS JOIN (VALUES
         ('vp_engineering',             'VP of Engineering',                          8, FALSE,  10),
         ('director_platform_arch',     'Director of Platform Architecture',          8, FALSE,  20),
         ('engineering_manager',        'Engineering Manager',                        6, FALSE,  30),
         ('senior_fullstack_developer', 'Senior Full-Stack Developer',                5, FALSE,  40),
         ('backend_engineer',           'Backend Engineer',                           4, FALSE,  50),
         ('frontend_engineer',          'Frontend Engineer',                          4, FALSE,  60),
         ('mobile_app_developer',       'Mobile App Developer',                       4, FALSE,  70),
         ('devops_sre',                 'DevOps / Site Reliability Engineer',         5, FALSE,  80),
         ('database_administrator',     'Database Administrator',                     5, FALSE,  90),
         ('ai_ml_engineer',             'AI / ML Engineer',                           5, FALSE, 100),
         ('qa_engineer',                'QA Engineer / Test Lead',                    4, FALSE, 110),
         ('security_engineer',          'Security Engineer',                          5, FALSE, 120),
         ('product_manager_platform',   'Product Manager - Platform',                 5, FALSE, 130),
         ('technical_program_manager',  'Technical Program Manager',                  5, FALSE, 140),
         ('ux_ui_designer',             'UX/UI Designer',                             4, FALSE, 150),
         ('it_support_specialist',      'IT Support Specialist',                      3, FALSE, 160)
       ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'technology'
ON CONFLICT (code) DO UPDATE
  SET department_id   = EXCLUDED.department_id,
      name            = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite       = EXCLUDED.is_csuite,
      sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- Operations & Customer Success
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
       CROSS JOIN (VALUES
         ('director_operations',        'Director of Operations',                     8, FALSE,  10),
         ('operations_manager',         'Operations Manager',                         6, FALSE,  20),
         ('marketplace_ops_associate',  'Marketplace Operations Associate',           3, FALSE,  30),
         ('customer_success_manager',   'Customer Success Manager',                   6, FALSE,  40),
         ('customer_support_lead',      'Customer Support Lead',                      5, FALSE,  50),
         ('support_rep_tier1',          'Support Representative (Tier 1)',            2, FALSE,  60),
         ('support_rep_tier2',          'Support Representative (Tier 2)',            3, FALSE,  70),
         ('helper_onboarding',          'Helper Onboarding Specialist',               3, FALSE,  80),
         ('verification_compliance',    'Verification & Compliance Officer',          5, FALSE,  90),
         ('escrow_payments_coordinator','Escrow & Payments Coordinator',              4, FALSE, 100),
         ('logistics_coordinator',      'Logistics Coordinator',                      3, FALSE, 110)
       ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'operations'
ON CONFLICT (code) DO UPDATE
  SET department_id   = EXCLUDED.department_id,
      name            = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite       = EXCLUDED.is_csuite,
      sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- Marketing, Sales & Growth
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
       CROSS JOIN (VALUES
         ('director_marketing',         'Director of Marketing',                      8, FALSE,  10),
         ('growth_marketing_manager',   'Growth Marketing Manager',                   6, FALSE,  20),
         ('performance_marketing_spec', 'Performance Marketing Specialist',           4, FALSE,  30),
         ('content_marketing_manager',  'Content Marketing Manager',                  6, FALSE,  40),
         ('social_media_manager',       'Social Media Manager',                       5, FALSE,  50),
         ('seo_sem_specialist',         'SEO / SEM Specialist',                       4, FALSE,  60),
         ('brand_creative_director',    'Brand & Creative Director',                  7, FALSE,  70),
         ('copywriter',                 'Copywriter',                                 3, FALSE,  80),
         ('community_manager',          'Community Manager',                          4, FALSE,  90),
         ('sales_dev_representative',   'Sales Development Representative',           3, FALSE, 100),
         ('partnerships_manager',       'Partnerships Manager',                       6, FALSE, 110)
       ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'marketing'
ON CONFLICT (code) DO UPDATE
  SET department_id   = EXCLUDED.department_id,
      name            = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite       = EXCLUDED.is_csuite,
      sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- Finance, Legal & Compliance
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
       CROSS JOIN (VALUES
         ('controller',                 'Controller',                                 7, FALSE,  10),
         ('accounting_manager',         'Accounting Manager',                         6, FALSE,  20),
         ('payroll_specialist',         'Payroll Specialist',                         4, FALSE,  30),
         ('financial_analyst',          'Financial Analyst',                          4, FALSE,  40),
         ('treasury_manager',           'Treasury Manager',                           6, FALSE,  50),
         ('risk_manager',               'Risk Manager',                               6, FALSE,  60),
         ('compliance_officer',         'Compliance Officer',                         6, FALSE,  70),
         ('kyc_aml_analyst',            'KYC / AML Analyst',                          4, FALSE,  80),
         ('contract_administrator',     'Contract Administrator',                     4, FALSE,  90),
         ('insurance_licensing_coord',  'Insurance & Licensing Coordinator',          4, FALSE, 100)
       ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'finance'
ON CONFLICT (code) DO UPDATE
  SET department_id   = EXCLUDED.department_id,
      name            = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite       = EXCLUDED.is_csuite,
      sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- People & Administrative
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
       CROSS JOIN (VALUES
         ('vp_people',                  'VP of People / HR Director',                 8, FALSE,  10),
         ('talent_acquisition',         'Talent Acquisition Specialist',              4, FALSE,  20),
         ('hr_generalist',              'HR Generalist',                              4, FALSE,  30),
         ('office_facilities_manager',  'Office / Facilities Manager',                5, FALSE,  40),
         ('admin_coordinator',          'Administrative Coordinator',                 2, FALSE,  50),
         ('data_entry_clerk',           'Data Entry Clerk',                           1, FALSE,  60)
       ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'people'
ON CONFLICT (code) DO UPDATE
  SET department_id   = EXCLUDED.department_id,
      name            = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite       = EXCLUDED.is_csuite,
      sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- Data, Research & Innovation
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
       CROSS JOIN (VALUES
         ('data_science_manager',       'Data Science Manager',                       6, FALSE,  10),
         ('bi_analyst',                 'Business Intelligence Analyst',              4, FALSE,  20),
         ('data_engineer',              'Data Engineer',                              5, FALSE,  30),
         ('user_researcher',            'User Researcher',                            4, FALSE,  40),
         ('innovation_lead',            'Innovation Lead',                            6, FALSE,  50)
       ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'data'
ON CONFLICT (code) DO UPDATE
  SET department_id   = EXCLUDED.department_id,
      name            = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite       = EXCLUDED.is_csuite,
      sort_order      = EXCLUDED.sort_order;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Corporate permission catalog
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_permissions (
  id          SERIAL       PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE,
  group_key   VARCHAR(40)  NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corp_perms_group
  ON corporate_permissions (group_key);

INSERT INTO corporate_permissions (code, group_key, description) VALUES
  -- platform.* (cross-cutting OxSteed product surface)
  ('platform.view_dashboard',        'platform',   'View admin dashboard.'),
  ('platform.view_users',            'platform',   'View user records.'),
  ('platform.edit_users',            'platform',   'Edit user records.'),
  ('platform.suspend_users',         'platform',   'Suspend or restrict users.'),
  ('platform.view_jobs',             'platform',   'View jobs across the platform.'),
  ('platform.moderate_jobs',         'platform',   'Edit or delete jobs.'),
  ('platform.view_businesses',       'platform',   'View businesses.'),
  ('platform.moderate_businesses',   'platform',   'Edit, flag, or deactivate businesses.'),
  ('platform.view_audit_log',        'platform',   'View the admin audit log.'),
  -- engineering.*
  ('engineering.feature_flags',      'engineering','Toggle feature flags.'),
  ('engineering.run_migrations',     'engineering','Run database migrations.'),
  ('engineering.view_logs',          'engineering','View server logs.'),
  ('engineering.view_metrics',       'engineering','View infrastructure metrics.'),
  ('engineering.deploy',             'engineering','Trigger or approve deploys.'),
  ('engineering.manage_api_keys',    'engineering','Create or revoke API keys.'),
  -- operations.*
  ('operations.view_marketplace_ops','operations', 'View marketplace operations queue.'),
  ('operations.manage_marketplace_ops','operations','Action on marketplace operations queue.'),
  ('operations.onboard_helpers',     'operations', 'Onboard new helpers.'),
  ('operations.verify_helpers',      'operations', 'Approve or reject helper verification.'),
  ('operations.handle_disputes',     'operations', 'Resolve disputes between parties.'),
  ('operations.escrow_actions',      'operations', 'Capture or release escrow funds.'),
  ('operations.support_tickets',     'operations', 'View and respond to support tickets.'),
  -- finance.*
  ('finance.view_financials',        'finance',    'View revenue, fees, and financial reports.'),
  ('finance.view_payouts',           'finance',    'View payout queue.'),
  ('finance.process_payouts',        'finance',    'Initiate or approve payouts.'),
  ('finance.issue_refunds',          'finance',    'Issue refunds to customers.'),
  ('finance.view_payroll',           'finance',    'View payroll information.'),
  ('finance.manage_pricing',         'finance',    'Edit pricing or fees.'),
  ('finance.export_financials',      'finance',    'Export financial data.'),
  -- legal.*
  ('legal.view_contracts',           'legal',      'View contracts and signed agreements.'),
  ('legal.manage_contracts',         'legal',      'Create or edit contracts.'),
  ('legal.view_legal_audit',         'legal',      'View legal audit log.'),
  ('legal.handle_ccpa_gdpr',         'legal',      'Handle CCPA / GDPR requests.'),
  ('legal.compliance_reports',       'legal',      'Generate compliance reports.'),
  -- marketing.*
  ('marketing.view_campaigns',       'marketing',  'View marketing campaigns.'),
  ('marketing.manage_campaigns',     'marketing',  'Create or edit marketing campaigns.'),
  ('marketing.send_broadcast',       'marketing',  'Send broadcast emails or SMS.'),
  ('marketing.view_analytics',       'marketing',  'View marketing analytics.'),
  ('marketing.manage_content',       'marketing',  'Manage marketing content and copy.'),
  ('marketing.manage_seo',           'marketing',  'Manage SEO and SEM settings.'),
  -- people.*
  ('people.view_team',               'people',     'View internal team roster.'),
  ('people.manage_team',             'people',     'Assign corporate titles and manage staff.'),
  ('people.view_pii',                'people',     'View internal staff PII.'),
  -- data.*
  ('data.view_analytics',            'data',       'View product analytics.'),
  ('data.export_data',               'data',       'Export platform data.'),
  ('data.manage_pipelines',          'data',       'Manage data pipelines.'),
  ('data.user_research',             'data',       'Run user research studies.'),
  -- corporate.* (self-management of the corporate hierarchy)
  ('corporate.view_org_chart',       'corporate',  'View the corporate org chart.'),
  ('corporate.assign_titles',        'corporate',  'Assign corporate titles to admins.'),
  ('corporate.manage_departments',   'corporate',  'Manage corporate departments and titles.'),
  ('corporate.set_overrides',        'corporate',  'Set per-assignment permission overrides.')
ON CONFLICT (code) DO UPDATE
  SET group_key   = EXCLUDED.group_key,
      description = EXCLUDED.description;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Department -> permission defaults  (hybrid model)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_department_permissions (
  department_id INTEGER NOT NULL REFERENCES corporate_departments(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES corporate_permissions(id)  ON DELETE CASCADE,
  allow         BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (department_id, permission_id)
);

-- Executive: every permission (department-level).
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM corporate_departments d CROSS JOIN corporate_permissions p
 WHERE d.code = 'executive'
ON CONFLICT (department_id, permission_id) DO NOTHING;

-- Technology
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM corporate_departments d CROSS JOIN corporate_permissions p
 WHERE d.code = 'technology'
   AND p.code IN (
     'platform.view_dashboard','platform.view_users','platform.view_jobs',
     'platform.view_businesses','platform.view_audit_log',
     'engineering.feature_flags','engineering.run_migrations','engineering.view_logs',
     'engineering.view_metrics','engineering.deploy','engineering.manage_api_keys',
     'data.view_analytics','data.manage_pipelines',
     'corporate.view_org_chart'
   )
ON CONFLICT (department_id, permission_id) DO NOTHING;

-- Operations
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM corporate_departments d CROSS JOIN corporate_permissions p
 WHERE d.code = 'operations'
   AND p.code IN (
     'platform.view_dashboard','platform.view_users','platform.edit_users','platform.suspend_users',
     'platform.view_jobs','platform.moderate_jobs',
     'platform.view_businesses','platform.moderate_businesses',
     'operations.view_marketplace_ops','operations.manage_marketplace_ops',
     'operations.onboard_helpers','operations.verify_helpers',
     'operations.handle_disputes','operations.escrow_actions','operations.support_tickets',
     'corporate.view_org_chart'
   )
ON CONFLICT (department_id, permission_id) DO NOTHING;

-- Marketing
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM corporate_departments d CROSS JOIN corporate_permissions p
 WHERE d.code = 'marketing'
   AND p.code IN (
     'platform.view_dashboard','platform.view_users','platform.view_jobs',
     'platform.view_businesses',
     'marketing.view_campaigns','marketing.manage_campaigns','marketing.send_broadcast',
     'marketing.view_analytics','marketing.manage_content','marketing.manage_seo',
     'data.view_analytics',
     'corporate.view_org_chart'
   )
ON CONFLICT (department_id, permission_id) DO NOTHING;

-- Finance
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM corporate_departments d CROSS JOIN corporate_permissions p
 WHERE d.code = 'finance'
   AND p.code IN (
     'platform.view_dashboard','platform.view_users','platform.view_audit_log',
     'finance.view_financials','finance.view_payouts','finance.process_payouts',
     'finance.issue_refunds','finance.view_payroll','finance.manage_pricing',
     'finance.export_financials',
     'legal.view_contracts','legal.manage_contracts','legal.view_legal_audit',
     'legal.handle_ccpa_gdpr','legal.compliance_reports',
     'corporate.view_org_chart'
   )
ON CONFLICT (department_id, permission_id) DO NOTHING;

-- People
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM corporate_departments d CROSS JOIN corporate_permissions p
 WHERE d.code = 'people'
   AND p.code IN (
     'platform.view_dashboard',
     'people.view_team','people.manage_team','people.view_pii',
     'corporate.view_org_chart','corporate.assign_titles'
   )
ON CONFLICT (department_id, permission_id) DO NOTHING;

-- Data
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM corporate_departments d CROSS JOIN corporate_permissions p
 WHERE d.code = 'data'
   AND p.code IN (
     'platform.view_dashboard','platform.view_users','platform.view_jobs',
     'platform.view_businesses',
     'data.view_analytics','data.export_data','data.manage_pipelines','data.user_research',
     'marketing.view_analytics',
     'corporate.view_org_chart'
   )
ON CONFLICT (department_id, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Corporate assignments
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_assignments (
  id                  BIGSERIAL    PRIMARY KEY,
  user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id            INTEGER      NOT NULL REFERENCES corporate_titles(id) ON DELETE RESTRICT,
  department_id       INTEGER      NOT NULL REFERENCES corporate_departments(id) ON DELETE RESTRICT,
  -- Geographic scope.  Either ISO 3166-1 alpha-2 country code OR a free-form
  -- region label (e.g. "LATAM", "EMEA") via region_id linking to admin_regions.
  -- NULL country_code + NULL region_id = global scope.
  country_code        CHAR(2),
  region_id           INTEGER      REFERENCES admin_regions(id) ON DELETE SET NULL,
  -- Reporting line (the user this assignment reports to).
  reports_to_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
  -- Lifecycle
  started_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Audit
  assigned_by_user_id UUID         NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corp_assign_user
  ON corporate_assignments (user_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_corp_assign_title
  ON corporate_assignments (title_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_corp_assign_dept
  ON corporate_assignments (department_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_corp_assign_country
  ON corporate_assignments (country_code)
  WHERE is_active = TRUE AND country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_corp_assign_region
  ON corporate_assignments (region_id)
  WHERE is_active = TRUE AND region_id IS NOT NULL;

-- One user cannot hold the same title twice at the same time in the same country.
CREATE UNIQUE INDEX IF NOT EXISTS idx_corp_assign_unique_active
  ON corporate_assignments (user_id, title_id, COALESCE(country_code, ''))
  WHERE is_active = TRUE;

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION corp_assignments_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_corp_assignments_touch ON corporate_assignments;
CREATE TRIGGER trg_corp_assignments_touch
  BEFORE UPDATE ON corporate_assignments
  FOR EACH ROW EXECUTE FUNCTION corp_assignments_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Per-assignment permission overrides
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_assignment_permission_overrides (
  id                 BIGSERIAL    PRIMARY KEY,
  assignment_id      BIGINT       NOT NULL REFERENCES corporate_assignments(id) ON DELETE CASCADE,
  permission_id      INTEGER      NOT NULL REFERENCES corporate_permissions(id) ON DELETE CASCADE,
  effect             VARCHAR(10)  NOT NULL CHECK (effect IN ('allow','deny')),
  reason             TEXT,
  granted_by_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_corp_overrides_assignment
  ON corporate_assignment_permission_overrides (assignment_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Assignment audit log
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corporate_assignment_audit_log (
  id              BIGSERIAL   PRIMARY KEY,
  assignment_id   BIGINT      REFERENCES corporate_assignments(id) ON DELETE SET NULL,
  action          VARCHAR(40) NOT NULL,
  performed_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  target_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  before_state    JSONB,
  after_state     JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corp_audit_assignment
  ON corporate_assignment_audit_log (assignment_id);

CREATE INDEX IF NOT EXISTS idx_corp_audit_performed_by
  ON corporate_assignment_audit_log (performed_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_corp_audit_target_user
  ON corporate_assignment_audit_log (target_user_id, created_at DESC);

COMMIT;
