-- Migration 617: durable scheduled profile-visibility actions + bulk idempotency.
--
-- Workstream A of the profile-visibility admin controls expansion. Scheduled
-- hide/restore rows are claimed by a minute-cron worker with
-- SELECT ... FOR UPDATE SKIP LOCKED, so multiple app instances can poll
-- safely. bulk_visibility_idempotency stores the exact JSON response of each
-- non-dry-run bulk request so a retried idempotency key replays the original
-- response without re-applying changes.
--
-- Workstream B compatibility: B's approval execution inserts scheduled rows
-- with (scheduled_at, approval_id) and omits (timezone, idempotency_key).
-- The canonical workstream-A columns are scheduled_for / timezone /
-- idempotency_key; the BEFORE INSERT trigger below backfills them from B's
-- shape so both workstreams write rows the worker can claim. approval_id
-- records which approval authorized the scheduled change (nullable: the
-- workstream-A /schedule endpoint stores it too when one was verified).

CREATE TABLE IF NOT EXISTS profile_visibility_scheduled_actions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_type    TEXT        NOT NULL CHECK (profile_type IN ('helper', 'business', 'restaurant')),
  profile_id      TEXT        NOT NULL,
  is_visible      BOOLEAN     NOT NULL,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  scheduled_at    TIMESTAMPTZ,
  timezone        TEXT        NOT NULL DEFAULT 'UTC',
  status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'applied', 'cancelled', 'failed')),
  idempotency_key TEXT        NOT NULL UNIQUE,
  approval_id     UUID,
  reason          TEXT,
  note            TEXT,
  created_by      UUID        NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ,
  cancelled_by    UUID,
  cancelled_at    TIMESTAMPTZ,
  failure_reason  TEXT
);

CREATE INDEX IF NOT EXISTS idx_pv_scheduled_status_due
  ON profile_visibility_scheduled_actions (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_pv_scheduled_profile
  ON profile_visibility_scheduled_actions (profile_type, profile_id);

-- Backfill canonical columns when a workstream-B style insert provides the
-- alias shape instead. Runs before NOT NULL checks, so B's insert (which
-- omits timezone/idempotency_key and names the due time scheduled_at)
-- lands as a fully valid workstream-A row.
CREATE OR REPLACE FUNCTION pv_scheduled_actions_compat()
RETURNS trigger AS $$
BEGIN
  IF NEW.scheduled_for IS NULL THEN
    NEW.scheduled_for := NEW.scheduled_at;
  ELSIF NEW.scheduled_at IS NULL THEN
    NEW.scheduled_at := NEW.scheduled_for;
  END IF;
  IF NEW.timezone IS NULL OR NEW.timezone = '' THEN
    NEW.timezone := 'UTC';
  END IF;
  IF NEW.idempotency_key IS NULL OR NEW.idempotency_key = '' THEN
    NEW.idempotency_key := 'pv-sched-auto-' || NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pv_scheduled_actions_compat ON profile_visibility_scheduled_actions;
CREATE TRIGGER trg_pv_scheduled_actions_compat
  BEFORE INSERT ON profile_visibility_scheduled_actions
  FOR EACH ROW EXECUTE FUNCTION pv_scheduled_actions_compat();

CREATE TABLE IF NOT EXISTS bulk_visibility_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  response        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID
);
