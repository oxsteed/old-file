-- Migration 343: Team permission catalog entries for restaurant Inventory apps.
-- Keeps Inventory app access aligned with Vortex/team permission overrides.

INSERT INTO team_permissions (code, group_key, description) VALUES
  ('inventory.view',   'restaurant_inventory', 'View restaurant inventory dashboards, stock, reports, suppliers, areas, transfers, receipts, and issues.'),
  ('inventory.update', 'restaurant_inventory', 'Record inventory counts, waste, receipts, transfer requests, purchase requests, and supplier issues.'),
  ('inventory.manage', 'restaurant_inventory', 'Manage inventory items, areas, suppliers, mappings, and approval/lifecycle actions.')
ON CONFLICT (code) DO UPDATE
  SET group_key = EXCLUDED.group_key,
      description = EXCLUDED.description;

-- Owners and managers can fully manage inventory.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN ('inventory.view', 'inventory.update', 'inventory.manage')
 WHERE r.code IN ('owner', 'manager')
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET allow = EXCLUDED.allow;

-- Representatives can inspect inventory, but not mutate it by default.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code = 'inventory.view'
 WHERE r.code = 'representative'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET allow = EXCLUDED.allow;

-- Employees can view and update stock operations, but not manage setup.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN ('inventory.view', 'inventory.update')
 WHERE r.code = 'employee'
ON CONFLICT (role_id, permission_id) DO UPDATE
  SET allow = EXCLUDED.allow;
