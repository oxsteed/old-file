-- Migration 041: Planned Needs
-- Future job + future funding + future activation system
-- OxSteed v2

CREATE TABLE IF NOT EXISTS planned_needs (
  id                       SERIAL PRIMARY KEY,
  user_id                  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                    VARCHAR(200) NOT NULL,
  description              TEXT,
  category                 VARCHAR(50)  NOT NULL DEFAULT 'other',
  -- 'car_care' | 'personal_care' | 'other'

  status                   VARCHAR(30)  NOT NULL DEFAULT 'planned',
  -- 'planned' | 'funding' | 'activating_soon' | 'published' | 'cancelled' | 'completed' | 'regenerated'

  due_date                 DATE         NOT NULL,
  estimated_cost           NUMERIC(10,2),
  actual_cost              NUMERIC(10,2),               -- filled on completion

  lead_time_days           SMALLINT     NOT NULL DEFAULT 7,  -- days before due_date to auto-publish

  recurrence_type          VARCHAR(20)  NOT NULL DEFAULT 'none',
  -- 'none' | 'fixed' | 'floating'
  -- fixed:    next due_date = completed_at + interval (calendar rhythm)
  -- floating: next due_date = actual completion date + interval

  recurrence_interval_days INTEGER,                     -- e.g. 90 for every 90 days

  published_job_id         UUID REFERENCES jobs(id) ON DELETE SET NULL,
  parent_need_id           INTEGER REFERENCES planned_needs(id) ON DELETE SET NULL,

  reserved_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,  -- manually tracked funding already set aside
  notes                    TEXT,

  cancelled_at             TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  published_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planned_needs_user    ON planned_needs(user_id);
CREATE INDEX IF NOT EXISTS idx_planned_needs_status  ON planned_needs(status);
CREATE INDEX IF NOT EXISTS idx_planned_needs_due     ON planned_needs(due_date);
CREATE INDEX IF NOT EXISTS idx_planned_needs_sched   ON planned_needs(user_id, status, due_date)
  WHERE status IN ('planned', 'funding', 'activating_soon');

-- updated_at auto-update (reuse set_updated_at() from migration 039 if it exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_planned_needs_updated_at') THEN
    CREATE TRIGGER trg_planned_needs_updated_at
      BEFORE UPDATE ON planned_needs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
