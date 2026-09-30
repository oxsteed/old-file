-- 608_reconciliation_exceptions.sql
-- Reconciliation exception workspace: durable record of reconciliation
-- failures across refund and payout-settlement domains, so admins can
-- triage, assign, acknowledge, and resolve them.

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL CHECK (domain IN ('credit','payment_refund','marketplace_refund','external_refund','payout_settlement')),
  reference_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  owner_admin_id UUID NULL,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  source_run_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_exceptions_open ON reconciliation_exceptions(domain, reference_id) WHERE status IN ('open','acknowledged');
CREATE INDEX IF NOT EXISTS idx_recon_exceptions_status ON reconciliation_exceptions(status, severity);
CREATE INDEX IF NOT EXISTS idx_recon_exceptions_domain ON reconciliation_exceptions(domain, status);
