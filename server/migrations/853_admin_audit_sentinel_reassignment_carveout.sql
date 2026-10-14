-- Migration 853: audit immutability carve-out for the scheduled-deletion sentinel reassignment.
--
-- P3-11-F03 (v8 residual): migration 406's trg_admin_audit_immutable /
-- prevent_admin_audit_update() RAISE on ANY UPDATE to admin_audit_log, so
-- migration 812's sentinel reassignment (scheduledDeletionJob.js
-- reassignToSentinel('admin_audit_log','admin_id')) could never succeed: the
-- UPDATE hit the trigger, the transaction rolled back, and the deletion job
-- retried forever.
--
-- The carve-out is deliberately narrow: an UPDATE is permitted only when the
-- sole change is admin_id moving toward the zero-UUID audit sentinel (the
-- permanent system user created by migration 812). Every other UPDATE still
-- raises, so the audit trail remains append-only in practice. Moving away
-- from the sentinel is not permitted (OLD.admin_id must differ from NEW).

CREATE OR REPLACE FUNCTION prevent_admin_audit_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Narrow carve-out (P3-11-F03): the scheduled user-deletion job may reassign
  -- audit rows belonging to a deleted user to the audit sentinel. Allowed only
  -- when admin_id is the single changed column and only when it changes toward
  -- the sentinel.
  IF NEW.admin_id = '00000000-0000-0000-0000-000000000000'::uuid
     AND OLD.admin_id IS DISTINCT FROM NEW.admin_id
     AND (to_jsonb(OLD) #- '{admin_id}') IS NOT DISTINCT FROM (to_jsonb(NEW) #- '{admin_id}')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Admin audit log entries are immutable';
END;
$$;
