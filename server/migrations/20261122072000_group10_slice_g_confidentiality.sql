-- Group 10 Slice G: maintain confidentiality (items 536-540).
-- Participant list (536), limited file sharing (537), confidentiality
-- acknowledgment (538), file access expiry (539), engagement record
-- export (540; the export itself is a read, so no table).
-- Audit overlap: G10-21 (files have no sharing control or expiry),
-- G10-32 (no participant list, no confidentiality acknowledgment),
-- G10-36 (no engagement-record export). None of those findings is
-- claimed closed here; they stay open pending re-verification against
-- the new head. Slice E's open call on document expiry is answered by
-- building 539 as the roadmap specifies (D-135).

-- Participants (536): named people beyond the two core parties (the
-- client owner and the assigned consultant, who are implicit and never
-- rows here). Roles are site_contact (the booking's contact person,
-- scoped read per G-6/G-7) and observer (read-only). A participant is
-- an existing OxSteed user, added by email; there are no guest
-- invites in Slice G (D-132). Removal is soft (removed_at) so the
-- history keeps who was involved.
CREATE TABLE IF NOT EXISTS consulting_session_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('site_contact', 'observer')),
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consulting_participant_active
  ON consulting_session_participants (session_id, user_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consulting_participants_session
  ON consulting_session_participants (session_id, added_at ASC);

-- Confidentiality acknowledgments (538): one row per party per
-- engagement, stamped with the terms version in force when they
-- acknowledged. A second acknowledge is a 409, never an overwrite.
CREATE TABLE IF NOT EXISTS consulting_confidentiality_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id BIGINT NOT NULL REFERENCES consulting_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('client', 'consultant', 'site_contact', 'observer')),
  terms_version VARCHAR(50) NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consulting_acknowledgment
  ON consulting_confidentiality_acknowledgments (session_id, user_id);
CREATE INDEX IF NOT EXISTS idx_consulting_acknowledgments_session
  ON consulting_confidentiality_acknowledgments (session_id, acknowledged_at ASC);

-- Named document shares (537): a document with visibility 'limited'
-- is readable only by the uploader, an admin, and the users listed
-- here. Shares are meaningless (and rejected) for any other
-- visibility.
CREATE TABLE IF NOT EXISTS consulting_document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES consulting_deliverable_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consulting_document_share
  ON consulting_document_shares (document_id, user_id);
CREATE INDEX IF NOT EXISTS idx_consulting_document_shares_document
  ON consulting_document_shares (document_id, created_at ASC);

-- Limited sharing + expiry on the documents table (537, 539).
-- 'limited' joins the Slice E visibility set; expires_at NULL means
-- the document never expires (D-135: no default expiry).
ALTER TABLE consulting_deliverable_documents
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consulting_deliverable_documents') THEN
    ALTER TABLE consulting_deliverable_documents
      DROP CONSTRAINT IF EXISTS consulting_deliverable_documents_visibility_check;
    ALTER TABLE consulting_deliverable_documents
      ADD CONSTRAINT consulting_deliverable_documents_visibility_check
      CHECK (visibility IN ('shared', 'client_only', 'consultant_only', 'internal', 'limited'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_consulting_documents_expires
  ON consulting_deliverable_documents (expires_at)
  WHERE expires_at IS NOT NULL;
