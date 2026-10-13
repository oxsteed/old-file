-- Review W4 (P3-912): agreement evidence and documents can be real uploads
-- held in private storage (served through short-lived signed URLs), and
-- legacy free-text URLs that are not plain https are neutralised.
ALTER TABLE work_agreement_evidence ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE work_agreement_evidence ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE work_agreement_documents ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE work_agreement_documents ADD COLUMN IF NOT EXISTS content_type TEXT;

ALTER TABLE work_agreement_evidence ALTER COLUMN file_url DROP NOT NULL;
ALTER TABLE work_agreement_documents ALTER COLUMN file_url DROP NOT NULL;

UPDATE work_agreement_evidence SET file_url = NULL
 WHERE file_url IS NOT NULL AND file_url !~* '^https://[^/@\s]+\.[^/@\s]+(/|$)';
UPDATE work_agreement_documents SET file_url = NULL
 WHERE file_url IS NOT NULL AND file_url !~* '^https://[^/@\s]+\.[^/@\s]+(/|$)';
