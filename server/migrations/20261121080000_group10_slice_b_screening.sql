-- Group 10 Slice B (items 511-515): screen inquiries.
-- Fit assessments and conflict declarations for business-launch
-- referrals (consulting_requests), the inquiries consultants actually
-- receive, plus author-role/template columns on the existing
-- consulting_request_messages table for consultant-authored replies.
-- All additions; nothing modified.

CREATE TABLE IF NOT EXISTS consulting_request_fit_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_fit SMALLINT CHECK (budget_fit BETWEEN 1 AND 5),
  scope_fit SMALLINT CHECK (scope_fit BETWEEN 1 AND 5),
  timing_fit SMALLINT CHECK (timing_fit BETWEEN 1 AND 5),
  overall_fit SMALLINT CHECK (overall_fit BETWEEN 1 AND 5),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('fit', 'no_fit', 'needs_info')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consulting_request_fit_one_per_consultant UNIQUE (request_id, consultant_id)
);

CREATE INDEX IF NOT EXISTS idx_consulting_request_fit_request
  ON consulting_request_fit_assessments(request_id);

CREATE TABLE IF NOT EXISTS consulting_request_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consulting_requests(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  has_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consulting_request_conflicts_one_per_consultant UNIQUE (request_id, consultant_id)
);

CREATE INDEX IF NOT EXISTS idx_consulting_request_conflicts_request
  ON consulting_request_conflicts(request_id);

ALTER TABLE consulting_request_messages
  ADD COLUMN IF NOT EXISTS author_role VARCHAR(20) NOT NULL DEFAULT 'admin'
    CHECK (author_role IN ('admin', 'consultant')),
  ADD COLUMN IF NOT EXISTS template_id VARCHAR(50);
