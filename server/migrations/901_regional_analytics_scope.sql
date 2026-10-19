-- Migration 901: region-scoped analytics (decision 3).
--
-- 1. Audit which scope every analytics execution ran under. Additive,
--    nullable columns on the append-only ledger (inserts are unaffected).
-- (The region-deletion safeguard is migration 902.)

ALTER TABLE analytics_query_audit
  ADD COLUMN IF NOT EXISTS scope_kind TEXT,
  ADD COLUMN IF NOT EXISTS region_ids INTEGER[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_query_audit_scope_kind_check') THEN
    ALTER TABLE analytics_query_audit
      ADD CONSTRAINT analytics_query_audit_scope_kind_check
      CHECK (scope_kind IS NULL OR scope_kind IN ('global', 'regional'));
  END IF;
END $$;
