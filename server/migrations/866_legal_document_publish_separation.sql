-- Migration 866: separation of duties for legal document publishing (ADM-036).
--
-- Publishing a legal document previously required only `manage_operations`
-- and the publishing admin could be the same person who drafted/requested
-- it. These columns record who requested approval and who actually approved
-- the publication, so the server can enforce maker != checker before a
-- document goes live.
--
-- Audit writes for legal-doc lifecycle events (create/edit/request-approval/
-- publish) now go to admin_audit_log via logAdminAction in routes/legalDocuments.js.

ALTER TABLE legal_document_drafts
  ADD COLUMN IF NOT EXISTS approval_requested_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE legal_document_drafts
  ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ;

ALTER TABLE legal_document_drafts
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE legal_document_drafts
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
