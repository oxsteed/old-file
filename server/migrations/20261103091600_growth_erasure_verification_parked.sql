-- Growth erasure verification failures used to leave queue rows pending
-- forever: the hourly worker rethrew growth_erasure_verification_failed
-- on every run with no bound and no incident. Park rows that fail
-- verification repeatedly so an operator can inspect them instead of
-- the queue retrying hourly without end. Parked rows are excluded from
-- the worker's selection (see jobs/growthErasure.js) until an operator
-- resets them to pending.

ALTER TABLE growth_erasure_queue
  ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'growth_erasure_queue'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE growth_erasure_queue DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE growth_erasure_queue
  ADD CONSTRAINT growth_erasure_queue_status_check
  CHECK (status IN ('pending', 'masked', 'complete', 'parked'));
