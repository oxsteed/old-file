-- Migration 150: Seed minimal live Privacy Policy when none exists (parity with terms hub)

BEGIN;

DO $$
DECLARE
  doc_id UUID;
  seed_content TEXT := 'This Privacy Policy describes how OxSteed collects, uses, and protects your information. Administrators can replace this content from the Legal Documents admin tools.';
BEGIN
  SELECT id INTO doc_id
  FROM legal_documents
  WHERE category = 'privacy_policy' AND status = 'live'
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
    'privacy_policy',
    'Privacy Policy',
    'How we handle your personal data on OxSteed.',
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
    'Privacy Policy',
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
