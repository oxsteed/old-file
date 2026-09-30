-- Migration 609: fraud_cases table for the fraud-case system.
-- Central record for fraud investigations against users or businesses.
-- Categories cover affiliate fraud, collusion, account takeover, chargebacks,
-- abuse reports, and other. Severity drives triage; status drives the
-- open -> investigating -> resolved/dismissed workflow.
-- Terminal-state integrity (resolved/dismissed cases require a resolution
-- timestamp and may only remain terminal or be reopened to open) is enforced
-- by the trigger below, mirroring the support-ticket guard in migration 600.

CREATE TABLE IF NOT EXISTS fraud_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'business')),
  subject_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'affiliate_fraud', 'collusion', 'account_takeover',
    'chargeback', 'abuse_report', 'other'
  )),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN (
    'low', 'medium', 'high', 'critical'
  )),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'investigating', 'resolved', 'dismissed'
  )),
  owner_admin_id UUID NULL,
  source TEXT NOT NULL CHECK (source IN (
    'auto_rule', 'user_report', 'stripe_webhook', 'manual'
  )),
  source_ref TEXT NULL,
  summary TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_fraud_cases_status_severity
  ON fraud_cases (status, severity);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_subject
  ON fraud_cases (subject_type, subject_id);

CREATE OR REPLACE FUNCTION enforce_fraud_case_terminal_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('resolved', 'dismissed')
     AND NEW.status NOT IN ('resolved', 'dismissed', 'open') THEN
    RAISE EXCEPTION 'Resolved or dismissed fraud cases may only remain terminal or be reopened to open'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('resolved', 'dismissed') AND NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'Resolved or dismissed fraud cases require a resolution timestamp'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fraud_case_terminal_integrity_guard ON fraud_cases;
CREATE TRIGGER fraud_case_terminal_integrity_guard
  BEFORE UPDATE OF status, resolved_at ON fraud_cases
  FOR EACH ROW
  EXECUTE FUNCTION enforce_fraud_case_terminal_integrity();
