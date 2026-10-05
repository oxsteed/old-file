-- Additive, money-neutral export evidence. Existing issued document contracts
-- and migration 682 originals remain unchanged. Temporary files are disposable;
-- frozen sources and verified export evidence are retained pending policy.
ALTER TABLE statement_snapshots ADD COLUMN IF NOT EXISTS frozen_document JSONB;
CREATE OR REPLACE FUNCTION statement_snapshot_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_document IS NOT NULL THEN
    RAISE EXCEPTION 'Frozen statement source and manifest are immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS statement_snapshot_document_immutable ON statement_snapshots;
CREATE TRIGGER statement_snapshot_document_immutable BEFORE UPDATE OR DELETE ON statement_snapshots
  FOR EACH ROW EXECUTE FUNCTION statement_snapshot_document_immutable();
CREATE TABLE IF NOT EXISTS statement_export_jobs (
  id UUID PRIMARY KEY,
  requested_by UUID NOT NULL REFERENCES users(id),
  product VARCHAR(24) NOT NULL CHECK (product IN ('oxsteed','restaurant','restaurant_settlement','helper_earnings','business')),
  account_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL CHECK (period_to >= period_from AND period_to-period_from<366),
  format VARCHAR(3) NOT NULL CHECK (format IN ('csv','pdf')),
  language VARCHAR(2) NOT NULL CHECK (language IN ('en','es','fr','ht','ar')),
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','freezing','rendering','complete','failed','cancelled')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  lease_owner UUID,
  fence BIGINT NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  frozen_header JSONB,
  frozen_at TIMESTAMPTZ,
  row_count BIGINT CHECK (row_count BETWEEN 0 AND 1000000),
  rows_rendered BIGINT NOT NULL DEFAULT 0 CHECK (rows_rendered>=0),
  source_hash CHAR(64),
  manifest JSONB,
  error_code VARCHAR(80),
  notification_state VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (notification_state IN ('pending','sent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (requested_by,idempotency_key),
  CHECK ((frozen_header IS NULL AND frozen_at IS NULL AND row_count IS NULL) OR
         (frozen_header IS NOT NULL AND frozen_at IS NOT NULL AND row_count IS NOT NULL)),
  CHECK (state<>'complete' OR (manifest IS NOT NULL AND source_hash IS NOT NULL AND rows_rendered=row_count))
);
CREATE INDEX IF NOT EXISTS statement_export_claim_idx ON statement_export_jobs(state,retry_at,created_at);
CREATE INDEX IF NOT EXISTS statement_export_fairness_idx ON statement_export_jobs(product,account_id,currency_code,updated_at);
-- A control record separate from the freeze lock lets cancellation return
-- immediately while the bounded source-copy transaction is still running.
CREATE TABLE IF NOT EXISTS statement_export_cancellations (
  job_id UUID PRIMARY KEY REFERENCES statement_export_jobs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS statement_export_rows (
  job_id UUID NOT NULL REFERENCES statement_export_jobs(id) ON DELETE RESTRICT,
  ordinal BIGINT NOT NULL CHECK (ordinal>0),
  source_id TEXT NOT NULL,
  source_date TIMESTAMPTZ NOT NULL,
  source_sequence BIGINT,
  row_data JSONB NOT NULL,
  credit_minor BIGINT NOT NULL,
  debit_minor BIGINT NOT NULL,
  balance_minor BIGINT NOT NULL,
  PRIMARY KEY (job_id,ordinal),
  UNIQUE (job_id,source_id)
);
CREATE TABLE IF NOT EXISTS statement_export_files (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES statement_export_jobs(id) ON DELETE RESTRICT,
  part INT NOT NULL CHECK (part>0),
  kind VARCHAR(6) NOT NULL CHECK (kind IN ('csv','volume')),
  row_from BIGINT NOT NULL,
  row_to BIGINT NOT NULL,
  opening_minor BIGINT NOT NULL,
  closing_minor BIGINT NOT NULL,
  credits_minor BIGINT NOT NULL,
  debits_minor BIGINT NOT NULL,
  row_hash CHAR(64) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  byte_length BIGINT NOT NULL CHECK (byte_length BETWEEN 1 AND 536870912),
  media_type VARCHAR(80) NOT NULL,
  storage_bucket VARCHAR(100) NOT NULL,
  object_key VARCHAR(400) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id,part)
);
CREATE OR REPLACE FUNCTION statement_export_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Frozen statement export evidence is immutable';
END $$;
DROP TRIGGER IF EXISTS statement_export_rows_immutable ON statement_export_rows;
CREATE TRIGGER statement_export_rows_immutable BEFORE UPDATE OR DELETE ON statement_export_rows
  FOR EACH ROW EXECUTE FUNCTION statement_export_evidence_immutable();
DROP TRIGGER IF EXISTS statement_export_files_immutable ON statement_export_files;
CREATE TRIGGER statement_export_files_immutable BEFORE UPDATE OR DELETE ON statement_export_files
  FOR EACH ROW EXECUTE FUNCTION statement_export_evidence_immutable();
CREATE OR REPLACE FUNCTION statement_export_job_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Statement export evidence cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.requested_by,NEW.product,NEW.account_id,NEW.scope_id,NEW.currency_code,
      NEW.period_from,NEW.period_to,NEW.format,NEW.language,NEW.idempotency_key,NEW.request_hash)
    IS DISTINCT FROM ROW(OLD.id,OLD.requested_by,OLD.product,OLD.account_id,OLD.scope_id,OLD.currency_code,
      OLD.period_from,OLD.period_to,OLD.format,OLD.language,OLD.idempotency_key,OLD.request_hash)
    OR (OLD.frozen_header IS NOT NULL AND ROW(NEW.frozen_header,NEW.frozen_at,NEW.row_count)
      IS DISTINCT FROM ROW(OLD.frozen_header,OLD.frozen_at,OLD.row_count))
    OR (OLD.source_hash IS NOT NULL AND NEW.source_hash IS DISTINCT FROM OLD.source_hash)
    OR (OLD.manifest IS NOT NULL AND NEW.manifest IS DISTINCT FROM OLD.manifest)
    OR (OLD.state='complete' AND NEW.state<>'complete') THEN
    RAISE EXCEPTION 'Statement export identity and completed evidence are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS statement_export_job_evidence_guard ON statement_export_jobs;
CREATE TRIGGER statement_export_job_evidence_guard BEFORE UPDATE OR DELETE ON statement_export_jobs
  FOR EACH ROW EXECUTE FUNCTION statement_export_job_evidence_guard();
