-- 20261107120000_scheduled_report_pending_status.sql
--
-- Design-review item 14: a partially failed scheduled-report delivery
-- was recorded as 'sent' before delivery, so the failure ledger insert
-- (ON CONFLICT DO NOTHING on the same dedupe key) never landed and the
-- date was never retried.
--
-- The deliveries status CHECK gains a 'pending' value so the send loop
-- can claim a row first, then mark it 'sent' only after delivery
-- succeeds or 'failed' on error. The claim makes the retry possible:
-- a 'failed' row is re-claimed on the next run, a 'sent' row is never
-- re-sent.
--
-- The CHECK in 20261106140000_phase7_compliance_reporting.sql is
-- inline and therefore auto-named, so this migration looks up the real
-- constraint name from pg_constraint (the CHECK on the status column
-- of this table) before dropping and re-adding it. The applied
-- migration itself is never edited. The re-added constraint keeps the
-- historical auto-generated name so readers and tooling see the same
-- identifier.

DO $$
DECLARE
  v_constraint TEXT;
  v_definition TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'restaurant_scheduled_report_deliveries'
  ) THEN
    RAISE NOTICE 'restaurant_scheduled_report_deliveries does not exist; skipping pending-status migration';
    RETURN;
  END IF;

  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO v_constraint, v_definition
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'restaurant_scheduled_report_deliveries'::regclass
     AND c.contype = 'c'
     AND a.attname = 'status'
     AND pg_get_constraintdef(c.oid) LIKE '%sent%'
   LIMIT 1;

  IF v_constraint IS NULL THEN
    RAISE NOTICE 'no status CHECK found on restaurant_scheduled_report_deliveries; skipping';
    RETURN;
  END IF;

  IF v_definition LIKE '%pending%' THEN
    RAISE NOTICE 'status CHECK % already includes pending; skipping', v_constraint;
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER TABLE restaurant_scheduled_report_deliveries DROP CONSTRAINT %I',
    v_constraint
  );
  ALTER TABLE restaurant_scheduled_report_deliveries
    ADD CONSTRAINT restaurant_scheduled_report_deliveries_status_check
    CHECK (status IN ('pending', 'sent', 'failed'));
END $$;
