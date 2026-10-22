-- Auth-audit finding 25: tip-pool / payroll sub-surfaces were gated by a
-- hard-coded role-name check (owner/manager), invisible to per-membership
-- deny overrides, and migration 245 seeded zero tips.* codes. Add the
-- catalog codes and grant them to owner + manager by default, preserving
-- today's access while making the operations grantable/revocable through
-- the catalog.
--
-- Additive; safe to re-run.

INSERT INTO team_permissions (code, group_key, description)
VALUES
  ('tips.view',   'finance', 'View tip reports and payroll exception summaries.'),
  ('tips.manage', 'finance', 'Manage tip pool settings and declare cash tips.')
ON CONFLICT (code) DO UPDATE
  SET group_key   = EXCLUDED.group_key,
      description = EXCLUDED.description;

-- OWNER: every permission (mirrors migration 245 section 6).
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r CROSS JOIN team_permissions p
 WHERE r.code = 'owner'
   AND p.code IN ('tips.view', 'tips.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- MANAGER: tips.view + tips.manage by default, preserving the previous
-- hard-coded owner/manager gate. Deny overrides can now revoke either.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r CROSS JOIN team_permissions p
 WHERE r.code = 'manager'
   AND p.code IN ('tips.view', 'tips.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
