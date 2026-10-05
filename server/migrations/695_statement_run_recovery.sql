-- Operational recovery only. Issued documents and financial ledgers are untouched.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'statement_issuance_runs'
                   AND column_name = 'discovery_phase') THEN
    ALTER TABLE statement_issuance_runs ADD COLUMN discovery_phase TEXT NOT NULL
      DEFAULT 'discovering' CHECK (discovery_phase IN ('discovering', 'running'));
    -- Legacy paused runs have no saved phase: rescan conservatively on resume.
    UPDATE statement_issuance_runs SET discovery_phase = 'running'
      WHERE state IN ('running', 'complete', 'failed');
  END IF;
END $$;
ALTER TABLE statement_issuance_runs ADD COLUMN IF NOT EXISTS discovery_cursor TEXT;
ALTER TABLE statement_issuance_runs ADD COLUMN IF NOT EXISTS discovery_generation BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS statement_runs_recovery_scan
  ON statement_issuance_runs(product, period_from, created_at)
  WHERE state IN ('discovering', 'running');
