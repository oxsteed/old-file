-- Helper quotes: formal line-item estimates helpers send to clients for a specific job
DO $$
DECLARE
  user_id_type TEXT;
  job_id_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO user_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'users'::regclass AND a.attname = 'id' AND NOT a.attisdropped;

  SELECT format_type(a.atttypid, a.atttypmod)
  INTO job_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'jobs'::regclass AND a.attname = 'id' AND NOT a.attisdropped;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS helper_quotes (
      id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id          %1$s         NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      helper_id       %2$s         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      line_items      JSONB        NOT NULL DEFAULT '[]',
      tax_rate        NUMERIC(6,5) NOT NULL DEFAULT 0,
      subtotal_cents  INTEGER      NOT NULL DEFAULT 0,
      tax_cents       INTEGER      NOT NULL DEFAULT 0,
      total_cents     INTEGER      NOT NULL DEFAULT 0,
      notes           TEXT,
      status          TEXT         NOT NULL DEFAULT 'sent'
                                  CHECK (status IN ('draft','sent','accepted','declined','expired','withdrawn')),
      valid_until     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  $sql$, job_id_type, user_id_type);
END $$;

CREATE INDEX IF NOT EXISTS idx_helper_quotes_job_id    ON helper_quotes(job_id);
CREATE INDEX IF NOT EXISTS idx_helper_quotes_helper_id ON helper_quotes(helper_id);

-- Auto-expire quotes past valid_until (run via cron or in-process on load)
-- UPDATE helper_quotes SET status='expired' WHERE status='sent' AND valid_until < NOW();
