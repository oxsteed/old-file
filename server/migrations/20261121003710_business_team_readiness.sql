CREATE TABLE business_team_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('guide','policy')),
 version INTEGER NOT NULL,
 title VARCHAR(200) NOT NULL,
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 published_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(business_id,kind,version)
);
CREATE TABLE business_team_acknowledgments (
 document_id UUID NOT NULL REFERENCES business_team_documents(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id),
 acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(document_id,user_id)
);
CREATE TABLE business_team_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 assignee_id UUID NOT NULL REFERENCES users(id),
 created_by UUID NOT NULL REFERENCES users(id),
 request_id UUID NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('task','reminder')),
 title VARCHAR(200) NOT NULL,
 due_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(created_by,request_id)
);
CREATE INDEX business_team_tasks_due_idx ON business_team_tasks(business_id,assignee_id,due_at) WHERE status='open';
ALTER TABLE staff_offboarding_records ADD COLUMN team_tasks_reassigned INTEGER NOT NULL DEFAULT 0;
