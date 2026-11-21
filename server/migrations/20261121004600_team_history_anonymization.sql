-- Retain team history when an account is erased, without blocking deletion.
ALTER TABLE business_team_acknowledgments ADD COLUMN id BIGSERIAL;
ALTER TABLE business_team_acknowledgments DROP CONSTRAINT business_team_acknowledgments_pkey;
ALTER TABLE business_team_acknowledgments ADD PRIMARY KEY(id);
ALTER TABLE business_team_acknowledgments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE business_team_acknowledgments DROP CONSTRAINT business_team_acknowledgments_user_id_fkey;
ALTER TABLE business_team_acknowledgments ADD FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE business_team_acknowledgments ADD UNIQUE(document_id,user_id);
ALTER TABLE business_team_tasks ALTER COLUMN assignee_id DROP NOT NULL;
ALTER TABLE business_team_tasks ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE business_team_tasks DROP CONSTRAINT business_team_tasks_assignee_id_fkey;
ALTER TABLE business_team_tasks DROP CONSTRAINT business_team_tasks_created_by_fkey;
ALTER TABLE business_team_tasks ADD FOREIGN KEY(assignee_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE business_team_tasks ADD FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL;
