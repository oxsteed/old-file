-- Review W3 (P1-131, P2-478): job acceptance and helper-completion lifecycle.

-- 1. accepted_at: stamped by trigger on every path into 'accepted'.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION jobs_stamp_accepted_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'accepted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    NEW.accepted_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_stamp_accepted_at ON jobs;
CREATE TRIGGER jobs_stamp_accepted_at
  BEFORE INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_stamp_accepted_at();

-- Backfill currently-accepted jobs from their accepted bid, but never earlier
-- than 4 days ago: every existing job gets at least 3 days of in-app warning
-- before the 7-day expiry sweep can act on it.
UPDATE jobs j
   SET accepted_at = GREATEST(
         COALESCE((SELECT MAX(b.updated_at) FROM bids b WHERE b.job_id = j.id AND b.status = 'accepted'), j.updated_at, NOW()),
         NOW() - INTERVAL '4 days')
 WHERE j.status = 'accepted' AND j.accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_accepted_expiry
  ON jobs (accepted_at) WHERE status = 'accepted';

-- 2. Helper completion requests on escrow jobs (customer confirms or the
--    request auto-confirms after HELPER_COMPLETION_CONFIRM_HOURS).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_requested_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_requested_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_completion_requested
  ON jobs (completion_requested_at) WHERE status = 'in_progress' AND completion_requested_at IS NOT NULL;

-- 3. cancellation_audit_log accepted only customer/helper, so admin and
--    system (expiry) cancellations of accepted jobs failed their audit insert.
ALTER TABLE cancellation_audit_log ALTER COLUMN cancelled_by_id DROP NOT NULL;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'cancellation_audit_log'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%cancelled_by_role%'
  LOOP
    EXECUTE format('ALTER TABLE cancellation_audit_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE cancellation_audit_log
  ADD CONSTRAINT cancellation_audit_log_role_check
  CHECK (cancelled_by_role IN ('customer', 'helper', 'admin', 'system'));
ALTER TABLE cancellation_audit_log
  ADD CONSTRAINT cancellation_audit_log_actor_check
  CHECK (cancelled_by_id IS NOT NULL OR cancelled_by_role = 'system');

-- 4. One-time expiry warning marker (reset whenever the job is re-accepted).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS expiry_warning_sent_at TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION jobs_stamp_accepted_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'accepted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    NEW.accepted_at := NOW();
    NEW.expiry_warning_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
