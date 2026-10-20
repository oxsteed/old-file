-- Migration 947: Permission catalog entries for restaurant Crew and Runner.
--
-- S-08: crew.update, crew.manage, runner.update and runner.manage existed
-- only in the hard-coded ROLE_PERMISSIONS map inside
-- restaurantAppFlowController.js. Because they were missing from
-- team_permissions they could not be granted or denied through
-- membership_permission_overrides, and any gate that consulted the catalog
-- silently ignored them. Adding them to the catalog makes the catalog the
-- single source of truth for restaurant staff permissions.
--
-- Role defaults below mirror the previous hard-coded ROLE_PERMISSIONS map
-- exactly, so baseline allow/deny outcomes are unchanged:
--   owner    -> every permission (owner grant in permissionsService)
--   manager  -> crew.manage, runner.manage
--   employee -> crew.update, runner.update
--   representative / support_agent -> none of the four

BEGIN;

INSERT INTO team_permissions (code, group_key, description) VALUES
  ('crew.update',   'restaurant_crew',   'Work crew tasks: start, complete, and submit crew checklist/task work.'),
  ('crew.manage',   'restaurant_crew',   'Manage crew tasks, checklists, and SOP authoring for the restaurant.'),
  ('runner.update', 'restaurant_runner', 'Work runner tasks assigned to the signed-in staff member.'),
  ('runner.manage', 'restaurant_runner', 'Manage runner tasks, assignments, and settlements.')
ON CONFLICT (code) DO UPDATE
  SET group_key = EXCLUDED.group_key,
      description = EXCLUDED.description;

-- Owners can run every crew/runner surface (permissionsService also grants
-- owners the full catalog; the explicit rows keep role-default exports and
-- the Team catalog UI consistent with the other restaurant groups).
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN ('crew.update', 'crew.manage', 'runner.update', 'runner.manage')
 WHERE r.code = 'owner'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET allow = EXCLUDED.allow;

-- Managers manage crew and runner work.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN ('crew.manage', 'runner.manage')
 WHERE r.code = 'manager'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET allow = EXCLUDED.allow;

-- Employees perform crew and runner work assigned to them.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN ('crew.update', 'runner.update')
 WHERE r.code = 'employee'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET allow = EXCLUDED.allow;

COMMIT;
