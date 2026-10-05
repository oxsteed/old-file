-- Existing artifacts retain unknown storage location until verified by an operator.
ALTER TABLE statement_artifacts ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
ALTER TABLE statement_artifacts ADD COLUMN IF NOT EXISTS publication_token UUID;
ALTER TABLE statement_artifacts ADD COLUMN IF NOT EXISTS rendition_label TEXT NOT NULL DEFAULT '';
ALTER TABLE statement_account_jobs ADD COLUMN IF NOT EXISTS issuance_language VARCHAR(10)
  CHECK (issuance_language IN ('en','es','fr','ht','ar'));
UPDATE statement_artifacts SET rendition_label = COALESCE(substring(object_key from '/renditions/([^/]+)/'), 'legacy')
WHERE kind = 'rendition' AND rendition_label = '';

-- Inline accessibility audit rows are not published objects. Duplicate active
-- published originals must be reviewed, not silently deleted during migration.
CREATE UNIQUE INDEX IF NOT EXISTS statement_artifacts_active_identity
ON statement_artifacts(snapshot_id, kind, language, rendition_label)
WHERE state <> 'failed' AND (kind = 'original' OR storage_bucket IS NOT NULL);

CREATE OR REPLACE FUNCTION protect_ready_statement_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'ready' THEN
    RAISE EXCEPTION 'Ready statement artifacts are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS statement_artifact_ready_immutable ON statement_artifacts;
CREATE TRIGGER statement_artifact_ready_immutable BEFORE UPDATE OR DELETE ON statement_artifacts
FOR EACH ROW EXECUTE FUNCTION protect_ready_statement_artifact();

CREATE OR REPLACE FUNCTION protect_statement_issuance_language() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.issuance_language IS NOT NULL AND NEW.issuance_language IS DISTINCT FROM OLD.issuance_language THEN
    RAISE EXCEPTION 'Statement original language is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS statement_original_language_immutable ON statement_account_jobs;
CREATE TRIGGER statement_original_language_immutable BEFORE UPDATE ON statement_account_jobs
FOR EACH ROW EXECUTE FUNCTION protect_statement_issuance_language();
