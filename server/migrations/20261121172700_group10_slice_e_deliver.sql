-- Group 10 Slice E: deliver work (items 526-530).
-- Milestone board (526) runs on consulting_deliverables, the session-scoped
-- milestone entity: add acceptance + draft-delivery states and the columns
-- that record them. Document exchange (527) gets a deliverable-documents
-- table mirroring business_launch_attachments (visibility + sha256 +
-- storage key; downloads are 900s signed URLs). Client feedback (529) can
-- name a deliverable. Start-engagement (D-118 handoff) links the session
-- to its referral so the approved proposal can seed the board once.

-- One engagement session per referral (start-engagement idempotency).
ALTER TABLE consulting_sessions
  ADD COLUMN IF NOT EXISTS referral_id UUID REFERENCES consulting_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_consulting_sessions_referral_unique
  ON consulting_sessions(referral_id) WHERE referral_id IS NOT NULL;

-- Acceptance + draft-delivery record on the milestone itself.
ALTER TABLE consulting_deliverables
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE consulting_deliverables
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE consulting_deliverables
  ADD COLUMN IF NOT EXISTS draft_note TEXT;
ALTER TABLE consulting_deliverables
  ADD COLUMN IF NOT EXISTS source_proposal_id BIGINT REFERENCES consulting_engagement_proposals(id) ON DELETE SET NULL;
ALTER TABLE consulting_deliverables
  ADD COLUMN IF NOT EXISTS source_proposal_deliverable_id BIGINT REFERENCES consulting_proposal_deliverables(id) ON DELETE SET NULL;

-- Extend the milestone status set: draft_delivered (528) and accepted (530).
-- The new set is a superset of the old one, so no existing row violates it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consulting_deliverables') THEN
    ALTER TABLE consulting_deliverables
      DROP CONSTRAINT IF EXISTS consulting_deliverables_status_check;
    ALTER TABLE consulting_deliverables
      ADD CONSTRAINT consulting_deliverables_status_check
      CHECK (status IN ('pending', 'in_progress', 'draft_delivered', 'completed', 'accepted', 'overdue'));
  END IF;
END;
$$;

-- Document exchange (527): files attached to a milestone, with the same
-- visibility + integrity shape as business_launch_attachments.
CREATE TABLE IF NOT EXISTS consulting_deliverable_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id BIGINT NOT NULL REFERENCES consulting_deliverables(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(255),
  size_bytes BIGINT,
  sha256 CHAR(64),
  visibility VARCHAR(20) NOT NULL DEFAULT 'shared'
    CHECK (visibility IN ('shared', 'client_only', 'consultant_only', 'internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_consulting_deliverable_documents_deliverable
  ON consulting_deliverable_documents(deliverable_id, created_at DESC);

-- Client feedback (529) may name the milestone it answers.
ALTER TABLE consulting_session_feedback
  ADD COLUMN IF NOT EXISTS deliverable_id BIGINT REFERENCES consulting_deliverables(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_consulting_session_feedback_deliverable
  ON consulting_session_feedback(deliverable_id);
