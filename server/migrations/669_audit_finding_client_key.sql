-- Migration 669: Offline-safe audit findings (franchise system).
-- Additive only. A client-generated key lets floor devices queue a finding
-- while offline and replay it without creating duplicates.

ALTER TABLE restaurant_audit_findings
  ADD COLUMN IF NOT EXISTS client_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_audit_findings_client_key
  ON restaurant_audit_findings(audit_id, client_key)
  WHERE client_key IS NOT NULL;
