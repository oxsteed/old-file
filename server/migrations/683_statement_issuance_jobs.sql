-- Durable issuance job infrastructure for statement operations (Phase 2A).
-- Coordinates automatic monthly issuance, archive publication, and background
-- exports. Jobs are scope-preserving snapshots of existing ledgers only; they
-- never initiate money movement.
CREATE TABLE IF NOT EXISTS statement_issuance_runs (
  id UUID PRIMARY KEY,
  product VARCHAR(20) NOT NULL CHECK (product IN ('oxsteed', 'restaurant')),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL CHECK (period_to >= period_from),
  state VARCHAR(20) NOT NULL DEFAULT 'discovering'
    CHECK (state IN ('discovering', 'running', 'paused', 'complete', 'failed')),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  issued_count INTEGER NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  completed_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS statement_issuance_runs_state
  ON statement_issuance_runs(state);

CREATE TABLE IF NOT EXISTS statement_account_jobs (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES statement_issuance_runs(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product VARCHAR(20) NOT NULL CHECK (product IN ('oxsteed', 'restaurant')),
  account_id BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  state VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'leased', 'snapshotted', 'artifact_ready', 'notified', 'complete', 'failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  lease_owner VARCHAR(100),
  lease_expires_at TIMESTAMPTZ,
  fencing_token BIGINT NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  issuance_key VARCHAR(200) NOT NULL UNIQUE,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (run_id, issuance_key)
);
-- Claim scan: pending jobs, expired leases, and due retries.
CREATE INDEX IF NOT EXISTS statement_account_jobs_claim_pending
  ON statement_account_jobs(run_id, state) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS statement_account_jobs_claim_expired
  ON statement_account_jobs(lease_expires_at) WHERE state = 'leased';
CREATE INDEX IF NOT EXISTS statement_account_jobs_claim_retry
  ON statement_account_jobs(next_retry_at) WHERE state = 'failed';
CREATE INDEX IF NOT EXISTS statement_account_jobs_run_state
  ON statement_account_jobs(run_id, state);

CREATE TABLE IF NOT EXISTS statement_outbox (
  id UUID PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  aggregate_type VARCHAR(40) NOT NULL,
  aggregate_id VARCHAR(200) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  claimed_at TIMESTAMPTZ,
  claimed_by VARCHAR(100),
  processed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
CREATE INDEX IF NOT EXISTS statement_outbox_unprocessed
  ON statement_outbox(processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS statement_outbox_claim
  ON statement_outbox(created_at) WHERE processed_at IS NULL AND claimed_at IS NULL;

COMMENT ON TABLE statement_issuance_runs IS
  'Monthly statement issuance runs. Durable coordination only; workers issue documents into credit_statement_documents.';
COMMENT ON TABLE statement_account_jobs IS
  'Per-account issuance jobs with DB-level leases and fencing tokens. One job per (run, issuance_key); scopes preserve product/tenant/account/currency.';
COMMENT ON TABLE statement_outbox IS
  'Transactional outbox for statement domain events (issued, notify, export ready). No PII in aggregate_id or payload keys.';
