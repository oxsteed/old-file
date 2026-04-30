-- Migration 149: Allow document_viewed audit actions + seed live Terms of Service when missing
-- Fixes public GET /api/legal/documents/terms_of_service failing when audit INSERT violates CHECK,
-- or when no live terms row exists yet.

BEGIN;

-- 1) Extend legal_audit_log.action_type CHECK to include document_viewed (used by getLegalDocument)
ALTER TABLE legal_audit_log DROP CONSTRAINT IF EXISTS valid_action_type;

ALTER TABLE legal_audit_log ADD CONSTRAINT valid_action_type CHECK (action_type IN (
  'document_created',
  'document_updated',
  'document_published',
  'document_archived',
  'document_viewed',
  'section_created',
  'section_updated',
  'section_deleted',
  'version_created',
  'version_published',
  'version_archived',
  'user_accepted',
  'user_reaccepted',
  'approval_requested',
  'approval_approved',
  'approval_rejected',
  'approval_revisions_requested',
  'translation_created',
  'translation_reviewed',
  'translation_published',
  'notification_sent',
  'notification_opened',
  'notification_clicked',
  'rollback_performed',
  'diff_viewed'
));

-- 2) Seed a minimal live Terms of Service document if none exists (section-based UI expects ≥1 section)
DO $$
DECLARE
  doc_id UUID;
  seed_content TEXT := 'Welcome to OxSteed. These Terms of Service govern your use of our marketplace and related services. Please review each section below. Administrators can replace this content from the Legal Documents admin tools.';
BEGIN
  SELECT id INTO doc_id
  FROM legal_documents
  WHERE category = 'terms_of_service' AND status = 'live'
  LIMIT 1;

  IF doc_id IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO legal_documents (
    category,
    title,
    description,
    current_content,
    status,
    current_version,
    published_at,
    effective_date
  ) VALUES (
    'terms_of_service',
    'Terms of Service',
    'Legal agreement for using the OxSteed platform.',
    seed_content,
    'live',
    1,
    NOW(),
    NOW()
  )
  RETURNING id INTO doc_id;

  INSERT INTO legal_document_versions (
    document_id,
    version_number,
    title,
    content,
    status,
    published_at
  ) VALUES (
    doc_id,
    1,
    'Terms of Service',
    seed_content,
    'live',
    NOW()
  );

  INSERT INTO legal_document_sections (
    document_id,
    section_key,
    title,
    content,
    section_order,
    is_critical
  ) VALUES (
    doc_id,
    'introduction',
    'Introduction',
    seed_content,
    0,
    FALSE
  );
END $$;

COMMIT;
