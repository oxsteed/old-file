-- Migration 813: drop dead audit tables.
--
-- P3-11-F19: consulting_audit_log (migration 102), helper_location_audits
-- (migration 195) and dispute_evidence_audit (migration 201) have zero
-- writers and zero readers anywhere in the codebase. They were created
-- speculatively and never wired up, so they only add schema surface and
-- confusion during audits. Drop them.
--
-- Verified: grep over server/ (js + sql) shows references only in their own
-- creation migrations; no code reads or writes these tables.

DROP TABLE IF EXISTS consulting_audit_log;
DROP TABLE IF EXISTS helper_location_audits;
DROP TABLE IF EXISTS dispute_evidence_audit;
