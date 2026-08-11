-- Migration 370: Restaurant workspace permissions and role defaults.
--
-- Restaurant web operations now use the same permission catalog and
-- per-membership overrides as the generic Business Hub. This keeps owner,
-- manager, representative, employee, and support access consistent across
-- the website and restaurant apps.

BEGIN;

INSERT INTO team_permissions (code, group_key, description) VALUES
  ('restaurant.manage', 'restaurant', 'Manage restaurant-wide operational settings.'),
  ('orders.view',       'restaurant_orders', 'View restaurant orders.'),
  ('orders.manage',     'restaurant_orders', 'Accept, prepare, complete, cancel, and refund restaurant orders.'),
  ('menu.view',         'restaurant_menu', 'View the managed restaurant menu.'),
  ('menu.manage',       'restaurant_menu', 'Create and update restaurant menu categories, items, and modifiers.'),
  ('credit.view',       'restaurant_credit', 'View restaurant-credit balances and settlement records.'),
  ('credit.manage',     'restaurant_credit', 'Load, hold, capture, release, and reconcile restaurant credit.'),
  ('settings.view',     'restaurant_settings', 'View restaurant settings, locations, and device configuration.'),
  ('settings.manage',   'restaurant_settings', 'Update restaurant settings, locations, and device configuration.'),
  ('pos.use',           'restaurant_pos', 'Use restaurant POS order-taking workflows.'),
  ('pos.manage',        'restaurant_pos', 'Manage POS shifts, payments, and configuration.'),
  ('kitchen.view',      'restaurant_kitchen', 'View the restaurant kitchen queue.'),
  ('kitchen.update',    'restaurant_kitchen', 'Advance kitchen order preparation states.'),
  ('kitchen.manage',    'restaurant_kitchen', 'Manage kitchen workflow configuration.'),
  ('display.view',      'restaurant_display', 'View restaurant display and queue surfaces.'),
  ('display.manage',    'restaurant_display', 'Manage restaurant display devices and configuration.'),
  ('support.view',      'restaurant_support', 'View restaurant support records.'),
  ('support.manage',    'restaurant_support', 'Manage restaurant support records.')
ON CONFLICT (code) DO UPDATE
  SET group_key = EXCLUDED.group_key,
      description = EXCLUDED.description;

-- Owners and managers can run every restaurant surface.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN (
    'restaurant.manage', 'orders.view', 'orders.manage',
    'menu.view', 'menu.manage', 'credit.view', 'credit.manage',
    'settings.view', 'settings.manage', 'pos.use', 'pos.manage',
    'kitchen.view', 'kitchen.update', 'kitchen.manage',
    'display.view', 'display.manage', 'support.view', 'support.manage'
  )
 WHERE r.code IN ('owner', 'manager')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allow = EXCLUDED.allow;

-- Representatives can answer customer questions and inspect order context.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN ('orders.view', 'menu.view', 'support.view')
 WHERE r.code = 'representative'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allow = EXCLUDED.allow;

-- Employees can operate the live order, POS, kitchen, and display workflow,
-- but cannot change menu, credit, or restaurant-wide settings by default.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN (
    'orders.view', 'pos.use', 'kitchen.view', 'kitchen.update', 'display.view'
  )
 WHERE r.code = 'employee'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allow = EXCLUDED.allow;

-- Support agents can inspect and manage support records only.
INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code IN ('support.view', 'support.manage')
 WHERE r.code = 'support_agent'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allow = EXCLUDED.allow;

COMMIT;
