-- PR #804 Track C (G-14): seed the bookings.manage permission code so the
-- business-booking mutation gate has a grantable permission behind it.
-- A business owner holds every code; managers hold bookings.manage by
-- default (accept / decline / counter-propose / cancel on business
-- bookings); a representative holds it only by explicit membership
-- override. Representatives without it keep read + message only.
INSERT INTO team_permissions (code, group_key, description) VALUES
  ('bookings.manage', 'jobs', 'Manage business bookings: accept, decline, counter-propose, and cancel.')
ON CONFLICT (code) DO UPDATE
  SET group_key = EXCLUDED.group_key,
      description = EXCLUDED.description;

INSERT INTO team_role_permissions (role_id, permission_id, allow)
SELECT r.id, p.id, TRUE
  FROM team_roles r
  JOIN team_permissions p ON p.code = 'bookings.manage'
 WHERE r.code = 'manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;
