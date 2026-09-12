-- Migration 431: keep OxSteed Credit audit events append-only.
--
-- Audit records are the evidence for operational and financial decisions.
-- Corrections should be recorded as a new event, never by rewriting history.

CREATE OR REPLACE FUNCTION reject_oxsteed_credit_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OxSteed Credit audit events are append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_audit_immutable_guard ON oxsteed_credit_audit_events;

CREATE TRIGGER oxsteed_credit_audit_immutable_guard
  BEFORE UPDATE OR DELETE ON oxsteed_credit_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_oxsteed_credit_audit_mutation();
