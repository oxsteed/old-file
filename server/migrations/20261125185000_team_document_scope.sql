-- Groups 5-6 item 269 (G5-18): assignment-only team documents. A document
-- may be scoped to one job or one member; the version chain is per
-- (business, kind, scope), and the old business-wide chain keeps its
-- versions because unscoped rows share the NULL scope. Additive and
-- idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_team_documents' AND column_name = 'job_id') THEN
    ALTER TABLE business_team_documents
      ADD COLUMN job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_team_documents' AND column_name = 'assignee_id') THEN
    ALTER TABLE business_team_documents
      ADD COLUMN assignee_id UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'business_team_documents_business_id_kind_version_key'
      AND conrelid = 'business_team_documents'::regclass
      AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE business_team_documents
      DROP CONSTRAINT business_team_documents_business_id_kind_version_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS business_team_documents_scope_version_idx
  ON business_team_documents (business_id, kind, version,
    COALESCE(job_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid));
