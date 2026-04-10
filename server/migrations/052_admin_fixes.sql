-- Migration 050: Fix two production bugs
--
-- Fix 1: admin_audit_log schema reconciliation
--   Migration 001 created admin_audit_log with ip_hash/notes columns.
--   Migration 005 used CREATE TABLE IF NOT EXISTS (skipped) with description/ip_address/user_agent.
--   auditService.js inserts description, ip_address, user_agent — add missing columns.
--
-- Fix 2: platform_ledger job_id FK vs ledger_no_update rule conflict
--   platform_ledger.job_id has ON DELETE SET NULL, but the ledger_no_update rule suppresses
--   all UPDATEs on platform_ledger. When a job is deleted, PostgreSQL tries to cascade-null
--   the job_id, the update rule swallows it, and the FK constraint violation aborts the DELETE.
--   The ledger is an immutable audit trail — job_id is a historical reference, not a live FK.
--   Dropping the FK lets job deletion succeed while preserving historical job_id values.

-- ── Fix 1: Add missing columns to admin_audit_log ────────────────────────────

ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS ip_address  INET,
  ADD COLUMN IF NOT EXISTS user_agent  TEXT;

-- Make admin_id nullable so system/trigger-generated entries can omit it.
-- (Migration 001 set it NOT NULL; auditService callers always pass it but
--  the log_address_reveal trigger can pass NULL for address_revealed_to.)
ALTER TABLE admin_audit_log
  ALTER COLUMN admin_id DROP NOT NULL;

-- ── Fix 2: Drop platform_ledger.job_id FK ────────────────────────────────────

ALTER TABLE platform_ledger
  DROP CONSTRAINT IF EXISTS platform_ledger_job_id_fkey;
