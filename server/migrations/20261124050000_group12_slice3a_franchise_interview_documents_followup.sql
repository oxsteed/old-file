-- Group 12 Slice 3a (604/603/605): franchise interview slots, applicant
-- documents, and the applicant/HQ decision follow-up thread.
-- Additive only; safe to run twice (IF NOT EXISTS throughout).

-- 604: dedicated franchise interview scheduling (D-300). HQ proposes slots
-- on an application; the applicant books one. The generic consulting
-- "strategy call" is a different product and is not touched.
CREATE TABLE IF NOT EXISTS franchise_interview_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  proposed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  interviewer_name VARCHAR(255),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'booked', 'completed', 'cancelled')),
  booked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  booked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_interview_slots_application
  ON franchise_interview_slots(application_id, starts_at);

-- At most one booked interview per application (D-303).
CREATE UNIQUE INDEX IF NOT EXISTS uq_franchise_interview_booked_per_application
  ON franchise_interview_slots(application_id) WHERE status = 'booked';

-- 603: applicant document checklist (D-296). Four categories only:
-- identity, entity, financials (capital proof), territory plan. The 8 HQ
-- process checklist items stay admin-only and are not applicant documents.
-- Files live under the private `franchise-documents/` storage prefix (never
-- publicly served; downloads only through signed URLs, D-302).
CREATE TABLE IF NOT EXISTS franchise_application_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL
    CHECK (category IN ('identity', 'entity', 'financials', 'territory_plan')),
  file_name VARCHAR(255) NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type VARCHAR(120),
  file_size_bytes INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  review_reason TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_documents_application
  ON franchise_application_documents(application_id, created_at DESC);

-- 605: decision follow-up thread (D-301). A dedicated thread table so
-- applicant replies are first-class; `franchise_application_notes` keeps
-- holding HQ notes, and `internal` notes are never returned to applicants.
CREATE TABLE IF NOT EXISTS franchise_followup_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  author_role VARCHAR(20) NOT NULL CHECK (author_role IN ('applicant', 'admin')),
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_followup_application
  ON franchise_followup_messages(application_id, created_at ASC);
