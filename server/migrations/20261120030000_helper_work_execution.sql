-- Private checklists belong to a helper/job pair; reassignment never transfers them.
CREATE TABLE IF NOT EXISTS helper_job_work (
 job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
 private_notes TEXT NOT NULL DEFAULT '',
 handover TEXT NOT NULL DEFAULT '',
 aftercare TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (job_id, helper_id),
 CHECK (jsonb_typeof(checklist) = 'array'),
 CHECK (version >= 0)
);
CREATE TABLE IF NOT EXISTS helper_work_updates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
 request_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (helper_id, request_id)
);
CREATE INDEX IF NOT EXISTS helper_work_updates_job_idx ON helper_work_updates(job_id, created_at DESC);
CREATE TABLE IF NOT EXISTS helper_checklist_templates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
 items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS helper_checklist_templates_owner_idx ON helper_checklist_templates(helper_id);
