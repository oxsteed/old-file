-- Migration 790: allow anonymous CCPA/CPRA opt-out requests.
ALTER TABLE ccpa_data_requests
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name
    FROM pg_constraint
   WHERE conrelid = 'ccpa_data_requests'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'ccpa_data_requests'::regclass AND attname = 'user_id')];
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ccpa_data_requests DROP CONSTRAINT %I', fk_name);
  END IF;
  ALTER TABLE ccpa_data_requests
    ADD CONSTRAINT ccpa_data_requests_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_ccpa_email_type_submitted
  ON ccpa_data_requests (lower(email), request_type, submitted_at DESC);
