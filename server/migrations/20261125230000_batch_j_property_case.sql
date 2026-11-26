-- Batch J (341-350): request-level relocation note, follow-up completion
-- stamp, and the request link on follow-up inspection records.
-- Additive and idempotent; safe to run twice.
ALTER TABLE IF EXISTS property_maintenance_requests
  ADD COLUMN IF NOT EXISTS relocation_note TEXT;
ALTER TABLE IF EXISTS property_maintenance_requests
  ADD COLUMN IF NOT EXISTS relocation_until DATE;
ALTER TABLE IF EXISTS property_maintenance_requests
  ADD COLUMN IF NOT EXISTS follow_up_done_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS property_compliance_records
  ADD COLUMN IF NOT EXISTS request_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'property_compliance_records_request_id_fk'
      AND t.relname = 'property_compliance_records'
  ) THEN
    ALTER TABLE property_compliance_records
      ADD CONSTRAINT property_compliance_records_request_id_fk
      FOREIGN KEY (request_id) REFERENCES property_maintenance_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_property_compliance_records_request
  ON property_compliance_records (request_id);
