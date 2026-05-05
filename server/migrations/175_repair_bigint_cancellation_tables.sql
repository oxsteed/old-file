-- Migration 175: Repair broken cancellation_* tables from failed 172 (BIGINT job_id vs UUID jobs.id)
-- Safe when tables are empty or only existed from a failed migration; idempotent.
-- After this runs, migration 172 can succeed on a fresh apply if 172 was never recorded in _migrations.

DO $$
DECLARE
  audit_job_type TEXT;
  fees_job_type TEXT;
  audit_n BIGINT;
  fees_n BIGINT;
BEGIN
  SELECT c.data_type INTO audit_job_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'cancellation_audit_log'
    AND c.column_name = 'job_id';

  SELECT c.data_type INTO fees_job_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'cancellation_fees'
    AND c.column_name = 'job_id';

  IF audit_job_type = 'bigint' OR fees_job_type = 'bigint' THEN
    SELECT COUNT(*) INTO audit_n FROM cancellation_audit_log;
    SELECT COUNT(*) INTO fees_n FROM cancellation_fees;

    IF audit_n > 0 OR fees_n > 0 THEN
      RAISE EXCEPTION '175_repair_bigint_cancellation_tables: cancellation_* tables have BIGINT job_id with data; manual migration required';
    END IF;

    DROP TABLE IF EXISTS cancellation_fees CASCADE;
    DROP TABLE IF EXISTS cancellation_audit_log CASCADE;
  END IF;
END
$$;
