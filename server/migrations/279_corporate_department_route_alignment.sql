BEGIN;

-- Align legacy corporate department codes with the newer company-wide
-- internal workspace route model.

UPDATE corporate_departments
   SET code = 'corporate_ops',
       name = 'Corporate Operations',
       description = 'Day-to-day corporate execution, customer success, verification, and launch readiness.',
       icon = 'building-2',
       color = '#f59e0b',
       updated_at = NOW()
 WHERE code = 'operations';

UPDATE corporate_departments
   SET code = 'hr',
       name = 'Human Resources & People',
       description = 'Recruitment, HR operations, culture, and internal administrative support.',
       icon = 'users',
       color = '#db2777',
       updated_at = NOW()
 WHERE code = 'people';

INSERT INTO corporate_departments (code, name, description, icon, color, sort_order, is_active)
VALUES (
  'legal',
  'Legal & Regulatory',
  'Contracts, privacy, regulatory interpretation, licensing support, and legal controls.',
  'scale',
  '#6366f1',
  55,
  TRUE
)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      color = EXCLUDED.color,
      sort_order = EXCLUDED.sort_order,
      is_active = EXCLUDED.is_active,
      updated_at = NOW();

INSERT INTO corporate_titles (department_id, code, name, seniority_level, is_csuite, sort_order)
SELECT d.id, t.code, t.name, t.seniority, t.csuite, t.sort_order
  FROM corporate_departments d
  CROSS JOIN (
    VALUES
      ('chief_legal_officer',        'Chief Legal Officer',                 9, TRUE,  10),
      ('legal_counsel',              'Legal Counsel',                       7, FALSE, 20),
      ('contracts_manager',          'Contracts Manager',                   6, FALSE, 30),
      ('privacy_regulatory_manager', 'Privacy & Regulatory Manager',        6, FALSE, 40),
      ('legal_operations_manager',   'Legal Operations Manager',            5, FALSE, 50)
  ) AS t(code, name, seniority, csuite, sort_order)
 WHERE d.code = 'legal'
ON CONFLICT (code) DO UPDATE
  SET department_id = EXCLUDED.department_id,
      name = EXCLUDED.name,
      seniority_level = EXCLUDED.seniority_level,
      is_csuite = EXCLUDED.is_csuite,
      sort_order = EXCLUDED.sort_order,
      updated_at = NOW();

WITH legal_department AS (
  SELECT id FROM corporate_departments WHERE code = 'legal'
),
legal_permissions AS (
  SELECT id, code
    FROM corporate_permissions
   WHERE code IN (
     'legal.view_contracts',
     'legal.manage_contracts',
     'legal.view_legal_audit',
     'legal.handle_ccpa_gdpr',
     'legal.compliance_reports'
   )
)
INSERT INTO corporate_department_permissions (department_id, permission_id, allow)
SELECT d.id, p.id, TRUE
  FROM legal_department d
  CROSS JOIN legal_permissions p
ON CONFLICT (department_id, permission_id) DO UPDATE
  SET allow = EXCLUDED.allow;

COMMIT;
