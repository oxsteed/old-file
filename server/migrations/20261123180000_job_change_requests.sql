-- Group 4 rest, item 183 (closes G4-22; Emile approved 2026-11-23): change
-- requests for hired jobs WITHOUT an open work agreement (jobs with one keep
-- work_agreement_change_orders). The helper proposes a scope/price change,
-- the customer may counter, and only the other party to the latest version
-- can accept. Every version is a row (thread_id + version), so the full
-- history is kept. Accepting reuses the change-order money path
-- (jobChangeOrderFinance.applyApprovedChangeOrder): nothing is charged
-- automatically; increases above the authorization ask the customer to
-- re-authorize. Additive and idempotent.
CREATE TABLE IF NOT EXISTS job_change_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  thread_id          UUID NOT NULL,
  version            INTEGER NOT NULL CHECK (version >= 1),
  parent_id          UUID REFERENCES job_change_requests(id) ON DELETE SET NULL,
  proposed_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description        TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 4000),
  line_items         JSONB,
  price_change_cents BIGINT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed', 'countered', 'accepted', 'declined', 'withdrawn')),
  decided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  applied_job_value_cents BIGINT,
  payment_adjustment JSONB,
  client_request_id  TEXT CHECK (client_request_id IS NULL OR char_length(client_request_id) <= 100),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (thread_id, version)
);
CREATE INDEX IF NOT EXISTS idx_job_change_requests_job ON job_change_requests (job_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_change_requests_open_per_job
  ON job_change_requests (job_id) WHERE status = 'proposed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_change_requests_client_request
  ON job_change_requests (job_id, proposed_by, client_request_id) WHERE client_request_id IS NOT NULL;
