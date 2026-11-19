INSERT INTO team_permissions (code, group_key, description)
VALUES ('statements.view', 'finance', 'View issued business statements.')
ON CONFLICT (code) DO NOTHING;
